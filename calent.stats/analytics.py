import pandas as pd
import json
import os

# Path to the log file from environment variable
log_file = os.getenv('LOG_FILE')
if not log_file:
    raise ValueError("LOG_FILE environment variable not set")

# Load the log file into a Pandas DataFrame
data = pd.read_csv(log_file)

# Perform Analysis
results = {}

# 1. Calculate the average latency
average_latency = data['Latency'].mean()
results['average_latency'] = average_latency

# 2. Calculate the median latency
median_latency = data['Latency'].median()
results['median_latency'] = median_latency

# 3. Calculate the 99.99th percentile latency
percentile_9999 = data['Latency'].quantile(0.9999)
results['percentile_99.99'] = percentile_9999

# 4. Count the total number of messages that meet the KPI
kpi_met_count = data[data['KPI'] == 'meets KPI'].shape[0]
results['messages_meeting_kpi'] = kpi_met_count

# 5. Count the total number of messages that do not meet the KPI
kpi_not_met_count = data[data['KPI'] != 'meets KPI'].shape[0]
results['messages_not_meeting_kpi'] = kpi_not_met_count

# 6. Find the top 5 messages with the highest latency
top_5_latency = data.nlargest(5, 'Latency')
results['top_5_highest_latency'] = top_5_latency.to_dict(orient='records')

# Output results as JSON to stdout
print(json.dumps(results, indent=4))
