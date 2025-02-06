import { v4 as uuidv4 } from "uuid";
import {PubSub} from "./pubsub";
import {Message} from "../message/message";
import {PathArray} from "../pathArray/pathArray";

describe("PubSub", () => {
    let pubSub: PubSub;

    beforeEach(async () => {
        pubSub = new PubSub();
        process.env.KAFKA_TOPIC = uuidv4();
        await pubSub.runWorker();
    });

    afterEach(async () => {
        await pubSub.disposeAsync();
    });

    test("publish and subscribe with correct seqnoPath and tagPath", async () => {
        const seqnoPath = PathArray.fromArray(["pathA", "pathB"]);
        const tagPath = PathArray.fromArray(["pathA", "pathB", "pathC"]);

        const message = new Message();
        message.set("testTag", "testValue");

        await pubSub.publish(seqnoPath, tagPath, message);

        const subscribedMessages = await pubSub.subscribe(seqnoPath);

        const { message: receivedMessage } = await subscribedMessages.get();
        expect(receivedMessage.get("testTag")).toBe("testValue");
        expect(tagPath.startsWith(seqnoPath)).toBe(true);
    });

    test("publish and subscribe with incorrect seqnoPath and tagPath", async () => {
        const seqnoPath = PathArray.fromArray(["pathA", "pathB"]);
        const tagPath = PathArray.fromArray(["pathX", "pathY"]);

        const message = new Message();
        message.set("testTag", "testValue");

        await expect(pubSub.publish(seqnoPath, tagPath, message)).rejects.toThrowError(/Invalid input: tagPath must start with seqnoPath/);
    });
});
