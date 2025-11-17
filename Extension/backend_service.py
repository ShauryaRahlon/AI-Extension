from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os

app = Flask(__name__)
CORS(app)  # Allow extension to call this server

CLIENT_ID = "95116700360-13ege5jmfrjjt4vmd86oh00eu5jlei5e.apps.googleusercontent.com"
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'message': 'Backend service running'})

@app.route('/exchange-code', methods=['POST']) 
def exchange_code():
    """Exchange authorization code for access + refresh tokens"""
    data = request.json
    code = data.get('code')
    redirect_uri = data.get('redirect_uri')
    
    if not code or not redirect_uri:
        return jsonify({'error': 'Missing code or redirect_uri'}), 400
    
    try:
        response = requests.post(
            'https://oauth2.googleapis.com/token',
            data={
                'code': code,
                'client_id': CLIENT_ID,
                'client_secret': CLIENT_SECRET,
                'redirect_uri': redirect_uri,
                'grant_type': 'authorization_code'
            },
            timeout=10
        )
        
        if response.status_code != 200:
            return jsonify({
                'error': 'Token exchange failed',
                'details': response.text
            }), response.status_code
        
        token_data = response.json()
        return jsonify({
            'access_token': token_data.get('access_token'),
            'refresh_token': token_data.get('refresh_token'),
            'expires_in': token_data.get('expires_in', 3600),
            'token_type': token_data.get('token_type')
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/refresh-token', methods=['POST'])
def refresh_token():
    """Get new access token using refresh token"""
    data = request.json
    refresh_token_value = data.get('refresh_token')
    
    if not refresh_token_value:
        return jsonify({'error': 'Missing refresh_token'}), 400
    
    try:
        response = requests.post(
            'https://oauth2.googleapis.com/token',
            data={
                'refresh_token': refresh_token_value,
                'client_id': CLIENT_ID,
                'client_secret': CLIENT_SECRET,
                'grant_type': 'refresh_token'
            },
            timeout=10
        )
        
        if response.status_code != 200:
            return jsonify({
                'error': 'Token refresh failed',
                'details': response.text
            }), response.status_code
        
        token_data = response.json()
        return jsonify({
            'access_token': token_data.get('access_token'),
            'expires_in': token_data.get('expires_in', 3600),
            'token_type': token_data.get('token_type')
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    if not CLIENT_SECRET:
        print("\n❌ ERROR: GOOGLE_CLIENT_SECRET environment variable not set!")
        print("\nSet it with:")
        print("  export GOOGLE_CLIENT_SECRET='your-secret-here'")
        exit(1)
    
    print("\n" + "="*60)
    print("✅ Backend service starting on http://localhost:5000")
    print("="*60)
    app.run(host='0.0.0.0', port=5000, debug=True)