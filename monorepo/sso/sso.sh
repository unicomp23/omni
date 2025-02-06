#!/bin/bash

# Login with AWS SSO
echo "Logging in with AWS SSO..."
aws --profile eng sso login
if [ $? -ne 0 ]; then
    echo "Failed to login with AWS SSO"
    exit 1
fi

# Get SSO start URL, region, and role name from AWS config file
echo "Getting SSO start URL, region, and role name from AWS config file..."
sso_start_url=$(aws configure get sso_start_url --profile eng)
sso_region=$(aws configure get sso_region --profile eng)
sso_role_name=$(aws configure get sso_role_name --profile eng)
sso_account_id=$(aws configure get sso_account_id --profile eng)
if [ -z "$sso_start_url" ] || [ -z "$sso_region" ] || [ -z "$sso_role_name" ] || [ -z "$sso_account_id" ]; then
    echo "Failed to get SSO configuration from AWS config file"
    exit 1
fi
echo "SSO start URL: $sso_start_url"
echo "SSO region: $sso_region"
echo "SSO role name: $sso_role_name"
echo "SSO account ID: $sso_account_id"

# Get the latest SSO access token from the cache
echo "Getting SSO access token..."
sso_cache_file=$(ls ~/.aws/sso/cache/ | grep .json | tail -n 1)
if [ -z "$sso_cache_file" ]; then
    echo "Failed to get SSO cache file"
    exit 1
fi
echo "SSO cache file: $sso_cache_file"
echo "SSO cache file contents:"
cat ~/.aws/sso/cache/$sso_cache_file
sso_access_token=$(jq -r .accessToken ~/.aws/sso/cache/$sso_cache_file)
if [ -z "$sso_access_token" ] || [ "$sso_access_token" == "null" ]; then
    echo "Failed to get SSO access token"
    exit 1
fi
echo "SSO access token: $sso_access_token"

# Get SSO role credentials
echo "Getting SSO role credentials..."
sso_role_credentials=$(aws --region $sso_region sso get-role-credentials --profile eng --role-name $sso_role_name --account-id $sso_account_id --access-token $sso_access_token --query 'roleCredentials' --output json)
if [ -z "$sso_role_credentials" ]; then
    echo "Failed to get SSO role credentials"
    exit 1
fi
echo "SSO role credentials: $sso_role_credentials"

# Extract values from SSO role credentials
echo "Extracting values from SSO role credentials..."
aws_access_key_id=$(echo $sso_role_credentials | jq -r .accessKeyId)
aws_secret_access_key=$(echo $sso_role_credentials | jq -r .secretAccessKey)
aws_session_token=$(echo $sso_role_credentials | jq -r .sessionToken)
if [ -z "$aws_access_key_id" ] || [ -z "$aws_secret_access_key" ] || [ -z "$aws_session_token" ]; then
    echo "Failed to extract values from SSO role credentials"
    exit 1
fi
echo "AWS access key ID: $aws_access_key_id"
echo "AWS secret access key: $aws_secret_access_key"
echo "AWS session token: $aws_session_token"

# Export environment variables
echo "Exporting environment variables..."
export AWS_ACCESS_KEY_ID=$aws_access_key_id
export AWS_SECRET_ACCESS_KEY=$aws_secret_access_key
export AWS_SESSION_TOKEN=$aws_session_token

echo "Environment variables are set."
