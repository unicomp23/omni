import {Engine} from "@babylonjs/core/Engines/engine";
import {Scene} from "@babylonjs/core/scene";
import {ArcRotateCamera} from "@babylonjs/core/Cameras/arcRotateCamera";
import {Vector3} from "@babylonjs/core/Maths/math.vector";
import {CreateSphere} from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import {CreateGround} from "@babylonjs/core/Meshes/Builders/groundBuilder";
import {StandardMaterial} from "@babylonjs/core/Materials/standardMaterial";
import {CreateSceneClass} from "../createScene";

// If you don't need the standard material you will still need to import it since the scene requires it.
// import "@babylonjs/core/Materials/standardMaterial";
import {Texture} from "@babylonjs/core/Materials/Textures/texture";

import grassTextureUrl from "../../assets/grass.jpg";
import {DirectionalLight} from "@babylonjs/core/Lights/directionalLight";
import {ShadowGenerator} from "@babylonjs/core/Lights/Shadows/shadowGenerator";

import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import {AdvancedDynamicTexture, InputText, StackPanel, TextBlock} from "@babylonjs/gui";
import {chat_client} from "./util/chat_client";
import {connect} from "nats.ws";

function doGeometry(canvas: HTMLCanvasElement, scene: Scene) {
    function debugLayer() {
        void Promise.all([
            import("@babylonjs/core/Debug/debugLayer"),
            import("@babylonjs/inspector"),
        ]).then((_values) => {
            console.log(_values);
            scene.debugLayer.show({
                handleResize: true,
                overlay: true,
                globalRoot: document.getElementById("#root") || undefined,
            });
        });
    }

    //debugLayer();

    // This creates and positions a free camera (non-mesh)
    const camera = new ArcRotateCamera(
        "my first camera",
        0,
        Math.PI / 3,
        10,
        new Vector3(0, 0, 0),
        scene
    );

    // This targets the camera to scene origin
    camera.setTarget(Vector3.Zero());

    // This attaches the camera to the canvas
    camera.attachControl(canvas, true);

    // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
    // const light = new HemisphericLight(
    //     "light",
    //     new Vector3(0, 1, 0),
    //     scene
    // );

    // // Default intensity is 1. Let's dim the light a small amount
    // light.intensity = 0.7;

    // Our built-in 'sphere' shape.
    const sphere = CreateSphere(
        "sphere",
        {diameter: 2, segments: 32},
        scene
    );

    // Move the sphere upward 1/2 its height
    sphere.position.y = 1;

    // Our built-in 'ground' shape.
    const ground = CreateGround(
        "ground",
        {width: 6, height: 6},
        scene
    );

    // Load a texture to be used as the ground material
    const groundMaterial = new StandardMaterial("ground material", scene);
    groundMaterial.diffuseTexture = new Texture(grassTextureUrl, scene);

    ground.material = groundMaterial;
    ground.receiveShadows = true;

    const light = new DirectionalLight(
        "light",
        new Vector3(0, -1, 1),
        scene
    );
    light.intensity = 0.5;
    light.position.y = 10;

    const shadowGenerator = new ShadowGenerator(512, light)
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurScale = 2;
    shadowGenerator.setDarkness(0.2);

    shadowGenerator.getShadowMap()!.renderList!.push(sphere);
}

export class DefaultSceneWithTexture implements CreateSceneClass {
    createScene = async (
        engine: Engine,
        canvas: HTMLCanvasElement
    ): Promise<Scene> => {
        
        // This creates a basic Babylon Scene object (non-mesh)
        
        const scene = new Scene(engine);
        doGeometry(canvas, scene);

        // grpc/connect-es client
        
        const app_id = `123`;
        const channel_id = `345`;
        const chat_user_id = crypto.randomUUID();
        const chat_client_ = chat_client.create(app_id, channel_id, chat_user_id);

        /// nats.ws
        
        const nc = await connect(
            {
                servers: [`wss://${location.host}/jetstream/ws`],
            },
        );
        console.log(`connected to ${nc.getServer()}`);
        /*
        // this promise indicates the client closed
        const done = nc.closed();
        // do something with the connection

        // close the connection
        await nc.close();
        // check if the close was OK
        const err = await done;
        if (err) {
            console.log(`error closing:`, err);
        }*/
        
        ///

        console.log(`starting v1.0 ...`);
        
        /// UI
        const advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("UI", true, scene);

        const stack_panel = new StackPanel();
        advancedTexture.addControl(stack_panel);

        const chat_dialogue_widget = new TextBlock();
        chat_dialogue_widget.name = "chat_dialogue";
        chat_dialogue_widget.text = "Hello world\nanotherworld";
        chat_dialogue_widget.color = "white";
        chat_dialogue_widget.fontSize = 24;
        chat_dialogue_widget.width = 1;
        chat_dialogue_widget.height = "600px";
        chat_dialogue_widget.textHorizontalAlignment = 0;
        chat_dialogue_widget.textVerticalAlignment = 1;
        chat_dialogue_widget.horizontalAlignment = 0;
        stack_panel.addControl(chat_dialogue_widget);

        const chat_input_widget = new InputText();
        chat_input_widget.name = "chat_message";
        chat_input_widget.text = "";
        chat_input_widget.color = "white";
        chat_input_widget.background = "green";
        chat_input_widget.width = 0.2;
        chat_input_widget.height = "40px";
        chat_input_widget.horizontalAlignment = 0;
        chat_input_widget.onKeyboardEventProcessedObservable.add(eventData => {
            //console.log(`onKeyboardEventProcessedObservable: ${eventData.key}`)
            if(eventData.key === `Enter`) {
                chat_client_.publish(app_id, channel_id, chat_user_id, chat_input_widget.text).then(() => {
                    console.log(`publish.complete`);
                })
                chat_input_widget.text = ``;
            }
        });
        stack_panel.addControl(chat_input_widget);

        const chat_user_id_widget = new TextBlock();
        chat_user_id_widget.name = "chat_user_id";
        chat_user_id_widget.text = `chat user id: ${chat_user_id}`;
        chat_user_id_widget.color = "white";
        chat_user_id_widget.fontSize = 24;
        chat_user_id_widget.width = 1;
        chat_user_id_widget.height = "40px";
        chat_user_id_widget.textHorizontalAlignment = 0;
        chat_user_id_widget.textVerticalAlignment = 1;
        chat_user_id_widget.horizontalAlignment = 0;
        stack_panel.addControl(chat_user_id_widget);
        
        return scene;
    };
}

export default new DefaultSceneWithTexture();
