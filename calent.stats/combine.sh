# First, run parse_percentile.js on each file and collect reports
node ./util/parse_percentile.js runs/run1/consumer_ip-10-0-1-170.ec2.internal.log
node ./util/parse_percentile.js runs/run1/consumer_ip-10-0-0-177.ec2.internal.log
node ./util/parse_percentile.js runs/run2/consumer_ip-10-0-0-118.ec2.internal.log
node ./util/parse_percentile.js runs/run2/consumer_ip-10-0-1-129.ec2.internal.log
node ./util/parse_percentile.js runs/run3/consumer_ip-10-0-1-115.ec2.internal.log
node ./util/parse_percentile.js runs/run3/consumer_ip-10-0-0-38.ec2.internal.log

# Then run analytics.py on each file and collect results into a combined JSON
echo "[" > combined_analytics.json
export LOG_FILE=runs/run1/consumer_ip-10-0-1-170.ec2.internal.log && python analytics.py >> combined_analytics.json
echo "," >> combined_analytics.json
export LOG_FILE=runs/run1/consumer_ip-10-0-0-177.ec2.internal.log && python analytics.py >> combined_analytics.json
echo "," >> combined_analytics.json
export LOG_FILE=runs/run2/consumer_ip-10-0-0-118.ec2.internal.log && python analytics.py >> combined_analytics.json
echo "," >> combined_analytics.json
export LOG_FILE=runs/run2/consumer_ip-10-0-1-129.ec2.internal.log && python analytics.py >> combined_analytics.json
echo "," >> combined_analytics.json
export LOG_FILE=runs/run3/consumer_ip-10-0-1-115.ec2.internal.log && python analytics.py >> combined_analytics.json
echo "," >> combined_analytics.json
export LOG_FILE=runs/run3/consumer_ip-10-0-0-38.ec2.internal.log && python analytics.py >> combined_analytics.json
echo "]" >> combined_analytics.json
