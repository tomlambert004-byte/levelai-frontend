import requests
import json

# Replace with your actual credentials from the portal
CLIENT_ID = "YOUR_SANDBOX_CLIENT_ID"
CLIENT_SECRET = "YOUR_SANDBOX_CLIENT_SECRET"
AUTH_URL = "https://sandbox.api.changehealthcare.com/apipaint/v1/auth"
ELIGIBILITY_URL = "https://sandbox.api.changehealthcare.com/dental/eligibility/v1/verification"

def get_access_token():
    payload = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "client_credentials"
    }
    # Indented 4 spaces
    response = requests.post(AUTH_URL, data=payload, timeout=10)
    return response.json().get("access_token")

def check_mtc_eligibility(patient_data):
    token = get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    payload = {payload = {
        "controlNumber": "123456789",
        "tradingPartnerServiceId": "00001",  # This is the "Payer ID" field
        "subscriber": {
            "firstName": patient_data['first_name'],
            # ... rest of the code
        "controlNumber": "123456789",
        "subscriber": {
            "firstName": patient_data['first_name'],
            "lastName": patient_data['last_name'],
            "memberId": patient_data['member_id'],
            "dateOfBirth": patient_data['dob']
        },
        "provider": {
            "npi": "1234567890",
            "organizationName": "Pulp Dental Demo"
        },
        "serviceType": "35" 
    }

    res = requests.post(ELIGIBILITY_URL, headers=headers, json=payload, timeout=30)
    return res.json()

# This block MUST be flush against the left margin
if __name__ == "__main__":
    print("--- 🚀 PULP AI: CLEARINGHOUSE TEST STARTING 🚀 ---")
    
    test_patient = {
        "first_name": "JOHN",
        "last_name": "DOE",
        "member_id": "123456789",
        "dob": "1980-01-01"
    }
    }
    
    try:
        print("Connecting to Change Healthcare Sandbox...")
        results = check_mtc_eligibility(test_patient)
        print("--- ✅ SUCCESS: API RESPONSE RECEIVED ---")
        print(json.dumps(results, indent=2))
    except Exception as e:
        print(f"--- ❌ ERROR OCCURRED ---")
        print(e)