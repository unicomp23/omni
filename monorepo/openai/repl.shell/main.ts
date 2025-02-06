import * as readline from "readline";
import {Interface} from "readline";
import {Deferred} from "@esfx/async";
import {
  existsSync,
  lstatSync,
  readdir,
  readdirSync,
  readFileSync,
  readFileSync as rfSync,
  writeFile,
  writeFileSync as wfSync
} from "fs";
import path, {basename, dirname, join, relative, resolve} from "path";
import {ChatCompletionRequestMessage, Configuration, CreateCompletionRequest, OpenAIApi} from "openai";
import glob from 'glob';
import axios from "axios";
import {Readable} from "stream";

process.on("uncaughtException", (error: Error) => {
    console.error("======= Unhandled Exception =======");
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Stack trace:\n", error.stack);
    console.error("===================================");
});

class App {
    private readonly rl: Interface;
    private numberedFiles: string[] = [];
    private messages: ChatCompletionRequestMessage[] = [];
    private openai: OpenAIApi;
    private assistantFilepath: string;
    private model: string = '';

    constructor() {
        // Load the current model selection from a file or set it to a default value
        this.loadModelSelection();
        const configuration = new Configuration({
            apiKey: process.env.OPENAI_API_KEY,
        });
        this.openai = new OpenAIApi(configuration);

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            completer: this.filesAndDirectoriesCompleter.bind(this),
        });

        this.assistantFilepath = resolve("assistant.txt");
    }

    public async run(): Promise<void> {
        try {
            for (; ;) {
                const query = await this.getUserInput();
                console.log(`user: ${query}`);
                this.appendToFile("history.user.txt", query + "\n");

                if (query === "v3.5" || query === "v4") {
                    this.setModel(query);
                    continue;
                } else if (query === "help" || query === "?") {
                    this.showHelp();
                    continue;
                } else if (query.startsWith("cd ")) {
                    this.changeDirectory(query.substring(3).trim());
                    continue;
                } else if (query === "ls") {
                    this.listFiles();
                    continue;
                } else if (query.startsWith("up ")) {
                    await this.handleUpCommand(query.substring(3).trim());
                    continue;
                } else {
                    this.messages.push({role: "user", content: query});
                }

                await this.getAssistantResponse();
            }
        } catch (error) {
            const error_ = error as any;
            if (error_.response) {
                console.log(error_.response.status);
                console.log(error_.response.data);
            } else {
                console.log(error_.message);
            }
        }
    }

    // Create a new method to set the model and persist the selection
    private setModel(model_choice: string) {
        this.model = model_choice === "v4" ? "gpt-4" : "gpt-3.5-turbo";
        console.log(`Model changed to: ${this.model}`);
        this.saveModelSelection();
    }

    private async getUserInput(): Promise<string> {
        const user_query_task = new Deferred<string>();
        this.rl.question(`${this.model === 'gpt-3.5-turbo' ? 'v3.5' : 'v4'} >`, (user_query) => {
            user_query_task.resolve(user_query);
        });
        return await user_query_task.promise;
    }

    private appendToFile(fileName: string, content: string): void {
        writeFile(fileName, content, {flag: "a"}, (err) => {
            if (err) console.error(`Error appending file: ${err.message}`);
        });
    }

    private showHelp(): void {
        console.log("Available commands:");
        console.log("\tv3.5 - Switch to the GPT-3.5-turbo model.");
        console.log("\tv4 - Switch to the GPT-4 model.");
        console.log("\tls - List all files, directories, and symlinks in the current working directory.");
        console.log("\tcd <path> - Change the current working directory to the specified path relative to the current directory. Use 'cd ..' to move up a directory.");
        console.log("\tup glob <_pattern> - Send the contents of the files matching the specified glob pattern as a message.");
        console.log("\tOther text - Send your typed message to the assistant.");
        console.log("\tPress TAB for autocompletion of file paths and directories.");
        console.log("\thelp or ? - Show this help message.");
    }

    // Load model selection from a file or set a default value
    private loadModelSelection(): void {
        const configFile = "model_selection.txt";
        if (!existsSync(configFile)) {
            this.model = "gpt-3.5-turbo";
            this.saveModelSelection();
        } else {
            this.model = rfSync(configFile, "utf-8").trim();
            console.log(`Model loaded from file: ${this.model}`);
        }
    }

    // Save the model selection to a file
    private saveModelSelection(): void {
        const configFile = "model_selection.txt";
        wfSync(configFile, this.model, "utf-8");
    }

    private changeDirectory(newDirectory: string): void {
        try {
            const fullPath = join(process.cwd(), newDirectory);
            process.chdir(fullPath);
            console.log(`Working directory changed to: ${fullPath}`);
        } catch (error) {
            console.error(`Failed to change working directory: ${(error as Error).message}`);
        }
    }

    private listFiles(): void {
        this.numberedFiles = this.listFilesRecursively(process.cwd(), false);
        console.log(`Current directory (${process.cwd()}):`);
        let index = 1;
        this.numberedFiles.forEach((file, idx) => {
            const relativeFile = path.relative(process.cwd(), file);
            console.log(`${index}. ${relativeFile}`);
            index++;
        });
    }

    private async handleUpCommand(pattern: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            glob(pattern, async (err, files) => {
                if (err) {
                    console.error(`Error processing glob pattern: ${err.message}`);
                    reject(err);
                } else {
                    const assistantDir = dirname(this.assistantFilepath);

                    const fileObjects = files.map((filePath) => {
                        const fileContent = readFileSync(filePath).toString("utf8");
                        const relativePath = relative(assistantDir, filePath);
                        return {
                            filepath: relativePath,
                            filecontents: fileContent,
                        };
                    });

                    this.messages.push({
                        role: "user",
                        content: fileObjects
                            .map((obj) => "```\n" + `// file path: ${obj.filepath}\n${obj.filecontents}\n` + "\n```\n")
                            .join("\n"),
                    });

                    await this.getAssistantResponse();
                    resolve();
                }
            });
        });
    }

    private async getAssistantResponse(): Promise<void> {
        const requestBody = {
            model: this.model, // Use the 'model' property here
            messages: this.messages,
            stream: true,
        } as CreateCompletionRequest;

        const finished = new Deferred<boolean>();
        try {
            const response = await axios.post("https://api.openai.com/v1/chat/completions", requestBody, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                responseType: "stream",
            });

            const dataStream = response.data as Readable;
            let messageText = "";

            dataStream.on("data", (chunk) => {
                const chunkText = chunk.toString("utf-8");
                const jsonObjects = chunkText.split(/data:\s*/).filter((obj: any) => obj.trim());

                for (const jsonObject of jsonObjects) {
                    if (jsonObject.length === 0) continue;

                  if (jsonObject.startsWith("[DONE]")) {
                    continue;
                  }

                  try {
                        const chunkData = JSON.parse(jsonObject);

                        if (chunkData.choices && chunkData.choices[0].delta && chunkData.choices[0].delta.content) {
                            const content = chunkData.choices[0].delta.content;
                            messageText += content;

                            // Append the assistant response to 'assistant.txt'
                            this.appendToFile(this.assistantFilepath, content); // Modify this line
                        }
                    } catch (error) {
                        const check = jsonObject as string;
                        if (check && check.startsWith("[DONE]"))
                            return;
                        console.error(`Error parsing JSON object: ${error}`, jsonObject);
                    } finally {
                    }
                }
            });

            dataStream.on("end", () => {
                this.appendToFile(this.assistantFilepath, "\n<eof>\n\n");
                finished.resolve(true);
            });

            dataStream.on("error", (err) => {
                console.error(`Error while streaming response: ${err.message}`);
            });

        } catch (error: any) {
            if (error.response) {
                console.error(`Error status: ${error.response.status}`);
                console.error(`Error details: ${JSON.stringify(error.response.data, null, 2)}`);
                console.error(`Error headers: ${JSON.stringify(error.response.headers, null, 2)}`);
            } else {
                console.error(`Error: ${error.message}`);
            }
            return;
        }

        await finished.promise;
    }

    private listFilesRecursively(dir: string, recursive: boolean = true, excludeDir: string = "node_modules"): string[] {
        let results: string[] = [];
        const files = readdirSync(dir);

        for (const file of files) {
            if (file === excludeDir) continue;
            const fullPath = join(dir, file);
            const stat = lstatSync(fullPath);

            if (stat.isDirectory()) {
                if (recursive) {
                    results = results.concat(this.listFilesRecursively(fullPath, true, excludeDir));
                } else {
                    results.push(`${fullPath}/ (directory)`);
                }
            } else if (stat.isSymbolicLink()) {
                results.push(`${fullPath} (symlink)`);
            } else {
                results.push(`${fullPath} (file)`);
            }
        }

        return results;
    }

    private filesAndDirectoriesCompleter(
        line: string,
        callback: (err: any, result: [string[], string]) => void
    ): void {
        const userInput = line.split(" ").pop() || "";
        const directory = dirname(userInput);
        const prefix = basename(userInput);

        readdir(directory, (err, files) => {
            if (err) {
                callback(err, [[], line]);
                return;
            }

            const completions = files
                .filter((file) => file.startsWith(prefix))
                .map((file) => {
                    const path = join(directory, file);
                    const suffix = lstatSync(path).isDirectory() ? "/" : " ";
                    return line.slice(0, -prefix.length) + file + suffix;
                });

            callback(null, [completions, line]);
        });
    }
}

const app = new App();
app.run()
    .then(() => {
        console.log("exited");
    })
    .catch((error) => {
        console.error(`Error running main(): ${error.message}`);
    });