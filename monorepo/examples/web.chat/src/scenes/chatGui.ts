import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { CreateSceneClass } from "../createScene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";

import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Materials/Textures/Loaders/envTextureLoader";

import {
    AdvancedDynamicTexture,
    Control,
    InputText,
    ScrollViewer,
    StackPanel,
    TextBlock,
} from "@babylonjs/gui";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import {
    consumerOpts, createInbox,
    DiscardPolicy,
    JetStreamManager,
    Msg,
    NatsError,
    RetentionPolicy,
    StreamConfig,
    SubscriptionOptions
} from "nats.ws";
import { ConsumerOptsBuilder } from "nats.ws";
import { AckPolicy } from "nats.ws"; // Import AckPolicy from config-types

// Import NATS
import { connect, JSONCodec, NatsConnection, JetStreamClient } from "nats.ws";
import {IKeyboardEvent} from "@babylonjs/core";
import {Messages} from "nats.ws/lib/nats-base-client/error";

class ChatTerminalGUI {
    public readonly _scene: Scene;
    private _advancedTexture: AdvancedDynamicTexture;
    private _chatDialog: ScrollViewer | null = null;
    private _chatDialogContainer: StackPanel | null = null;
    private _textInput: InputText | null = null;
    private _natsConnection: NatsConnection | null = null;
    private _jetStream: JetStreamClient | null = null;
    private _jetStreamManager: JetStreamManager | null = null;
    private _stream = "chat";
    private _subject = "air";

    constructor(canvas: HTMLCanvasElement) {
        // Initialize Babylon.js
        const engine = new Engine(canvas, true);
        this._scene = new Scene(engine);

        // Attach the camera to the canvas
        const camera = new ArcRotateCamera(
            "camera",
            Math.PI / 4,
            Math.PI / 4,
            4,
            Vector3.Zero(),
            this._scene
        );
        camera.attachControl(canvas, true);

        // Set up light
        const light = new HemisphericLight("light", new Vector3(0, 1, 0), this._scene);
        light.intensity = 0.7;

        // Set up Babylon.js GUI
        this._advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("UI");

        // Create scrolling chat dialog
        this.createChatDialog();

        // Create text input box
        this.createTextInput();

        // Start rendering
        engine.runRenderLoop(() => {
            this._scene.render();
        });

        // Add resize event listener and update engine size
        const resizeEngine = () => {
            engine.resize();
        };
        window.addEventListener("resize", resizeEngine);

        // Connect to NATS
        this.connectToNats().then(async () => {
            // Set up JetStream stream
            console.log(`setupJetStream`);
            await this.setupJetStream();

            // Subscribe to JetStream messages
            console.log(`subscribeToJetStream`);
            await this.subscribeToJetStream();
        });
    }

    private async setupJetStream(): Promise<void> {
        if (this._jetStreamManager && this._jetStream && this._natsConnection) {
            // Define stream configuration
            const streamConfig = {
                name: `${this._stream}`,
                subjects: [`${this._subject}`],
            };

            // Create the stream if it doesn't exist
            try {
                console.log(`streams.find`);
                await this._jetStreamManager.streams.find(streamConfig.name);
            } catch (err) {
                console.log(`streams.add`);
                await this._jetStreamManager.streams.add(streamConfig);
            }
        }
    }
    
    public createChatDialog(): void {
        this._chatDialog = new ScrollViewer();
        this._chatDialog.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this._chatDialog.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this._chatDialog.width = "100%";
        this._chatDialog.height = "95%";
        this._chatDialog.barSize = 5;
        this._chatDialog.color = "#FFFFFF";

        this._chatDialogContainer = new StackPanel();
        this._chatDialogContainer.width = "100%";
        this._chatDialogContainer.height = "100%";
        this._chatDialogContainer.isVertical = true;
        this._chatDialog.addControl(this._chatDialogContainer);

        this._advancedTexture.addControl(this._chatDialog);
    }

    public createTextInput(): void {
        this._textInput = new InputText();
        this._textInput.width = "100%";
        this._textInput.height = "5%";
        this._textInput.maxWidth = "100%";
        this._textInput.text = "Type your message here...";
        this._textInput.color = "white";
        this._textInput.background = "#404040";
        this._textInput.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this._textInput.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;

        this._textInput.onFocusObservable.add(() => {
            if (this._textInput && this._textInput.text === "Type your message here...") {
                this._textInput.text = "";
            }
        });

        this._textInput.onKeyboardEventProcessedObservable.add(async (evt: IKeyboardEvent) => {
            if (
                evt.key === "Enter" &&
                this._textInput?.text &&
                this._textInput?.text !== "Type your message here..."
            ) {
                console.log("<enter>");
                await this.publishToNATS(this._textInput.text);
                if (this._textInput) {
                    this._textInput.text = "";
                    this._textInput.focus(); // Set the focus back to the text input after publishing the message
                }
            }
        });

        this._advancedTexture.addControl(this._textInput);
    }
    
    public callbackOnNewChat(message: string): void {
        const chatLine = new TextBlock();
        chatLine.text = message;
        chatLine.color = "white";
        chatLine.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        chatLine.paddingTop = "2px";
        chatLine.height = "30px";
        if (this._chatDialogContainer)
            this._chatDialogContainer.addControl(chatLine);
    }

    private async connectToNats(): Promise<void> {
        try {
            this._natsConnection = await connect({ servers: `wss://${location.host}/jetstream/ws` });
            this._jetStreamManager = await this._natsConnection.jetstreamManager();
            this._jetStream = this._natsConnection.jetstream();
        } catch (error) {
            console.error("Failed to connect to NATS server:", error);
        }
    }
    
    private async subscribeToJetStream(): Promise<void> {
        if (this._jetStream) {
            interface ChatMessage {
                message: string;
            }

            // Use ConsumerOptsBuilder to create subscription options //
            const opts = consumerOpts()
                .durable(`myDurable-${crypto.randomUUID()}`)
                .ackAll()
                .deliverTo(createInbox())
                .callback(
                    (err, msg) => {
                        if (err) {
                            console.error("JetStream subscription error:", err);
                        } else if (msg) {
                            const data = JSONCodec<ChatMessage>().decode(msg.data) as ChatMessage;
                            this.callbackOnNewChat(data.message);
                        }
                    },
                );

            const subscription = await this._jetStream.subscribe(`${this._subject}`, opts);
        }
    }
    
    private async publishToNATS(message: string): Promise<void> {
        if (this._jetStream) {
            const data = JSONCodec().encode({ message });
            await this._jetStream.publish(`${this._subject}`, data);
        }
    }
}

export class chatGui implements CreateSceneClass {
    createScene = async (
        engine: Engine,
        canvas: HTMLCanvasElement
    ): Promise<Scene> => {
        const chatTerminalGUI = new ChatTerminalGUI(canvas);

        // Return the scene used in the ChatTerminalGUI constructor
        return chatTerminalGUI._scene;
    };
}

export default new chatGui();
