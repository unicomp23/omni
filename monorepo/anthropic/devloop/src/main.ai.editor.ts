import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

function checkAwsCredentials() {
  const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const awsSessionToken = process.env.AWS_SESSION_TOKEN;

  if (!awsAccessKey || !awsSecretKey) {
    throw new Error("AWS access key and secret key must be set as environment variables.");
  }

  if (!awsSessionToken) {
    console.warn("AWS session token is not set. Continuing without it. This is fine for non-temporary credentials.");
  }

  return { awsAccessKey, awsSecretKey, awsSessionToken };
}

function initializeAnthropicClient() {
  const { awsAccessKey, awsSecretKey, awsSessionToken } = checkAwsCredentials();

  return new AnthropicBedrock({
    awsAccessKey,
    awsSecretKey, 
    awsSessionToken,
    awsRegion: AWS_REGION,
  });
}

const AWS_REGION = 'us-west-2';

//const ANTHROPIC_MODEL_ID = 'anthropic.claude-3-opus-20240229-v1:0';
// const ANTHROPIC_MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';
const ANTHROPIC_MODEL_ID = 'anthropic.claude-3-5-sonnet-20240620-v1:0';
//const ANTHROPIC_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
// 

const systemPrompt = `
As an expert in editing TypeScript files, you can generate unified diff patches to modify existing code when a user requests changes. Analyze the provided code and suggest modifications in the form of a unified diff patch. Please delimit unified diff patches with <unifieddiff> and </unifieddiff> tags.
--- a/path/to/original/file
+++ b/path/to/new/file
@@ -start_line,num_lines +start_line,num_lines @@
 context line
+added line
-context line
 context line

Aim to keep your responses concise, focusing on the most important information relevant to the user's request. If you are unsure about something or lack the necessary knowledge to provide a complete answer, it's better to acknowledge this limitation rather than guessing or making things up.

When communicating with users, maintain a friendly and professional tone. Use your expertise to guide them towards best practices and optimal solutions for their TypeScript needs.

If you understand and are ready to assist, please introduce yourself and ask the user how you can help with their TypeScript programming today!
`;

async function main(): Promise<void> {
  const client = initializeAnthropicClient();

  try {
    const logFilePath = path.join(__dirname, 'ai.log.txt');
    const logContent = fs.readFileSync(logFilePath, 'utf-8');
    
    await sendMessage(client, logContent);
  } catch (error) {
    console.error('Error calling Anthropic API:', error);
  }
}

async function sendMessage(client: AnthropicBedrock, logContent: string): Promise<void> {
  const MAX_TOKENS = 4096;
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL_ID,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        "role": "user", 
        "content": logContent
      }
    ],
    system: systemPrompt
  });
  console.log(response);

  // Append content.text to ai.log.txt with a newline character
  const logFilePath = path.join(__dirname, 'ai.log.txt');
  const contentText = response.content[0].text;
  fs.appendFileSync(logFilePath, 'assistant: ' + contentText + '\n');

  // Check for unified diff patch delimiters in the response
  const patchRegex = /<unifieddiff>([\s\S]*?)<\/unifieddiff>/g;
  const patchMatches = contentText.match(patchRegex);

  if (patchMatches) {
    // Write the unified diff patch content to diffs.patch
    const patchFilePath = path.join(__dirname, 'diffs.patch');
    let patchContent = '';

    for (const match of patchMatches) {
      const cleanedPatch = match.replace(/<\/?unifieddiff>/g, '');
      patchContent += cleanedPatch + '\n';
    }
    
    fs.writeFileSync(patchFilePath, patchContent, { flag: 'w' });
    console.log(`Unified diff patch written to ${patchFilePath}`);
  }
}
main().catch(console.error);
