example:  aws s3 cp /home/ec2-user/logs/ s3://cantina-jd/calent/013 --recursive
9:40 am

---
Here's the AWS CLI command to copy all files from the `/home/ec2-user/logs` directory to the S3 bucket `s3://cantina-jd`:

```bash
aws s3 cp /home/ec2-user/logs/ s3://cantina-jd/ --recursive
```

This command:
- `aws s3 cp`: initiates a copy operation
- `--recursive`: copies all files and subdirectories
- The trailing slashes are important to indicate directory copying

If you want to verify what will be copied before executing the actual copy, you can add the `--dryrun` flag:

```bash
aws s3 cp /home/ec2-user/logs/ s3://cantina-jd/ --recursive --dryrun
```
-----

Here's the AWS CLI command to download all files from `s3://cantina-jd` to your current directory:

```bash
aws s3 cp s3://cantina-jd/ . --recursive
```

Or if you want to specify a different local directory:

```bash
aws s3 cp s3://cantina-jd/ /path/to/local/directory/ --recursive
```

Again, you can use `--dryrun` to preview what will be downloaded:

```bash
aws s3 cp s3://cantina-jd/ . --recursive --dryrun
```

Note: 
- The `.` represents the current directory
- Make sure you have write permissions in the target directory
- The trailing slashes are important for directory operations
