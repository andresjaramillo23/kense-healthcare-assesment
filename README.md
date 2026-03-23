# Healthcare API Assessment

This project solves the KSense Healthcare API assessment by:

- Fetching paginated patient data from the assessment API
- Handling rate limits and intermittent server failures with retry logic
- Validating and normalizing inconsistent data
- Calculating patient risk scores based on:
  - Blood pressure
  - Temperature
  - Age
- Producing the required alert lists:
  - `high_risk_patients`
  - `fever_patients`
  - `data_quality_issues`

## Approach

The solution includes:

- Retry logic with exponential backoff for `429`, `500`, and `503`
- Pagination support for retrieving all patient records
- Validation logic for malformed or missing:
  - blood pressure
  - temperature
  - age
- Deterministic output formatting before submission

## Risk Scoring Rules

### Blood Pressure
- Normal: systolic <120 and diastolic <80 → 0
- Elevated: systolic 120–129 and diastolic <80 → 1
- Stage 1: systolic 130–139 or diastolic 80–89 → 2
- Stage 2: systolic ≥140 or diastolic ≥90 → 3

### Temperature
- ≤99.5 → 0
- 99.6–100.9 → 1
- ≥101.0 → 2

### Age
- <40 → 0
- 40–65 inclusive → 1
- >65 → 2

## Output Rules
- High risk: total score ≥ 4
- Fever: temperature ≥ 99.6
- Data quality issues: invalid or missing blood pressure, age, or temperature

## How to Run

1. Create a `.env` file:
   ```env
   API_KEY=your_api_key_here
