import {Message} from "./message";

describe("Message", () => {
    it("Should set and get values", () => {
        const msg = new Message();
        msg.set("name", "Alice");
        msg.set("age", "30");

        expect(msg.get("name")).toBe("Alice");
        expect(msg.get("age")).toBe("30");
    });

    it("Should handle empty tags and values", () => {
        expect(() => {
            const msg = new Message();
            msg.set("", "value");
        }).toThrowError("Invalid input: tag and value must be non-empty strings");

        expect(() => {
            const msg = new Message();
            msg.set("tag", "");
        }).toThrowError("Invalid input: tag and value must be non-empty strings");

        expect(() => {
            const msg = new Message();
            msg.set("", "");
        }).toThrowError("Invalid input: tag and value must be non-empty strings");
    });

    it("Should serialize and deserialize a message", () => {
        const msg1 = new Message();
        msg1.set("name", "Alice");
        msg1.set("age", "30");

        const serializedMsg1 = msg1.serialize();
        const {message: deserializedMsg1} = Message.deserialize(serializedMsg1);

        expect(deserializedMsg1.get("name")).toBe("Alice");
        expect(deserializedMsg1.get("age")).toBe("30");

        const msg2 = new Message();
        msg2.set("color", "blue");

        const serializedMsg2 = msg2.serialize();
        const {message: deserializedMsg2} = Message.deserialize(serializedMsg2);

        expect(deserializedMsg2.get("color")).toBe("blue");

        // Deserialize multiple messages from a combined string
        const combinedSerializedMsgs = serializedMsg1 + serializedMsg2;
        const {message: deserializedMsg3, offset} = Message.deserialize(combinedSerializedMsgs);
        const {message: deserializedMsg4} = Message.deserialize(combinedSerializedMsgs, offset);

        expect(deserializedMsg3.get("name")).toBe("Alice");
        expect(deserializedMsg3.get("age")).toBe("30");
        expect(deserializedMsg4.get("color")).toBe("blue");
    });

    it("Should handle invalid inputs for deserialize", () => {
        expect(() => {
            Message.deserialize("");
        }).toThrowError("Invalid input: serializedData must be a non-empty string");

        expect(() => {
            Message.deserialize("serializedData", -1);
        }).toThrowError("Invalid input: startingOffset must be a valid position in the serializedData");

        expect(() => {
            // Providing a large number as the startingOffset to test the error
            Message.deserialize("serializedData", 99999);
        }).toThrowError("Invalid input: startingOffset must be a valid position in the serializedData");
    });

});