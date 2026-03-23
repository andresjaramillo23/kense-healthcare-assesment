const API_KEY = "YOUR_API_KEY_HERE";
const BASE_URL = "https://assessment.ksensetech.com/api";

const DEFAULT_HEADERS = {
  "x-api-key": "ak_41e5975b4a377226e59cfce985c2a0942f00b4525caf0e2e",
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, options = {}, maxRetries = 5) {
  let attempt = 0;
  let delay = 500;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...DEFAULT_HEADERS,
          ...(options.headers || {}),
        },
      });

      if (response.ok) {
        return response;
      }

      if ([429, 500, 503].includes(response.status)) {
        if (attempt === maxRetries) {
          throw new Error(`Request failed after retries: ${response.status}`);
        }

        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : delay;
        await sleep(waitMs);
        delay *= 2;
        attempt++;
        continue;
      }

      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      await sleep(delay);
      delay *= 2;
      attempt++;
    }
  }

  throw new Error("Unexpected retry failure");
}

function extractPatients(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.patients)) return payload.patients;
  return [];
}

function extractPagination(payload, currentPage, currentLimit, currentBatchLength) {
  if (!payload || typeof payload !== "object") {
    return {
      hasNextPage: currentBatchLength === currentLimit,
      nextPage: currentPage + 1,
    };
  }

  if (payload.pagination && typeof payload.pagination === "object") {
    const p = payload.pagination;

    if (typeof p.hasNextPage === "boolean") {
      return {
        hasNextPage: p.hasNextPage,
        nextPage: typeof p.page === "number" ? p.page + 1 : currentPage + 1,
      };
    }

    if (typeof p.nextPage === "number") {
      return {
        hasNextPage: true,
        nextPage: p.nextPage,
      };
    }

    if (typeof p.totalPages === "number") {
      return {
        hasNextPage: currentPage < p.totalPages,
        nextPage: currentPage + 1,
      };
    }
  }

  if (typeof payload.nextPage === "number") {
    return { hasNextPage: true, nextPage: payload.nextPage };
  }

  return {
    hasNextPage: currentBatchLength === currentLimit,
    nextPage: currentPage + 1,
  };
}

function normalizePatientId(patient) {
  return (
    patient?.patient_id ||
    patient?.patientId ||
    patient?.id ||
    null
  );
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function parseBloodPressure(bp) {
  if (bp === null || bp === undefined) {
    return { valid: false, systolic: null, diastolic: null };
  }

  if (typeof bp !== "string") {
    return { valid: false, systolic: null, diastolic: null };
  }

  const trimmed = bp.trim();
  if (!trimmed) {
    return { valid: false, systolic: null, diastolic: null };
  }

  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    return { valid: false, systolic: null, diastolic: null };
  }

  const systolic = parseNumber(parts[0]);
  const diastolic = parseNumber(parts[1]);

  if (systolic === null || diastolic === null) {
    return { valid: false, systolic: null, diastolic: null };
  }

  return { valid: true, systolic, diastolic };
}

function getBpRisk(bpValue) {
  const { valid, systolic, diastolic } = parseBloodPressure(bpValue);

  if (!valid) {
    return { score: 0, valid: false };
  }

  let systolicScore = 0;
  let diastolicScore = 0;

  if (systolic >= 140) systolicScore = 3;
  else if (systolic >= 130) systolicScore = 2;
  else if (systolic >= 120) systolicScore = 1;
  else systolicScore = 0;

  if (diastolic >= 90) diastolicScore = 3;
  else if (diastolic >= 80) diastolicScore = 2;
  else diastolicScore = 0;

  let score = 0;

  if (systolic < 120 && diastolic < 80) {
    score = 0;
  } else if (systolic >= 120 && systolic <= 129 && diastolic < 80) {
    score = 1;
  } else {
    score = Math.max(systolicScore, diastolicScore);
  }

  return { score, valid: true };
}

function getTempRisk(tempValue) {
  const temp = parseNumber(tempValue);

  if (temp === null) {
    return { score: 0, valid: false, fever: false };
  }

  if (temp >= 101.0) {
    return { score: 2, valid: true, fever: true };
  }

  if (temp >= 99.6) {
    return { score: 1, valid: true, fever: true };
  }

  return { score: 0, valid: true, fever: false };
}

function getAgeRisk(ageValue) {
  const age = parseNumber(ageValue);

  if (age === null) {
    return { score: 0, valid: false };
  }

  if (age > 65) {
    return { score: 2, valid: true };
  }

  if (age >= 40) {
    return { score: 1, valid: true };
  }

  return { score: 0, valid: true };
}

function analyzePatients(patients) {
  const highRiskPatients = [];
  const feverPatients = [];
  const dataQualityIssues = [];

  for (const patient of patients) {
    const patientId = normalizePatientId(patient);
    if (!patientId) continue;

    const bp = getBpRisk(patient.blood_pressure);
    const temp = getTempRisk(patient.temperature);
    const age = getAgeRisk(patient.age);

    const totalRisk = bp.score + temp.score + age.score;

    const hasDataIssue = !bp.valid || !temp.valid || !age.valid;

    if (totalRisk >= 4) {
      highRiskPatients.push(patientId);
    }

    if (temp.fever) {
      feverPatients.push(patientId);
    }

    if (hasDataIssue) {
      dataQualityIssues.push(patientId);
    }
  }

  return {
    high_risk_patients: [...new Set(highRiskPatients)].sort(),
    fever_patients: [...new Set(feverPatients)].sort(),
    data_quality_issues: [...new Set(dataQualityIssues)].sort(),
  };
}

async function fetchAllPatients(limit = 20) {
  let page = 1;
  let allPatients = [];

  while (true) {
    const url = `${BASE_URL}/patients?page=${page}&limit=${limit}`;
    const response = await fetchWithRetry(url, { method: "GET" });
    const json = await response.json();

    const patients = extractPatients(json);
    allPatients = allPatients.concat(patients);

    const pagination = extractPagination(json, page, limit, patients.length);

    if (!pagination.hasNextPage || patients.length === 0) {
      break;
    }

    page = pagination.nextPage;

    await sleep(250);
  }

  return allPatients;
}

async function submitAssessment(payload) {
  const response = await fetchWithRetry(`${BASE_URL}/submit-assessment`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return response.json();
}

async function main() {
  try {
    console.log("Fetching patients...");
    const patients = await fetchAllPatients(20);
    console.log(`Fetched ${patients.length} patients`);

    const results = analyzePatients(patients);

    console.log("Submission payload:");
    console.log(JSON.stringify(results, null, 2));

    console.log("Submitting assessment...");
    const submissionResponse = await submitAssessment(results);

    console.log("Submission response:");
    console.log(JSON.stringify(submissionResponse, null, 2));
  } catch (error) {
    console.error("Assessment failed:", error);
    process.exit(1);
  }
}

main();
