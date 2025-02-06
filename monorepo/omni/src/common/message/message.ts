import {LengthDelimitedString} from "../lengthDelimitedString/lengthDelimitedString";

export class Message {
    private data: Map<string, string>;

    constructor() {
        this.data = new Map();
    }

    public static deserialize(serializedData: string, startingOffset: number = 0): {
        message: Message;
        offset: number
    } {
        if (typeof serializedData !== 'string' || serializedData.length === 0) {
            throw new Error('Invalid input: serializedData must be a non-empty string');
        }

        if (typeof startingOffset !== 'number' || startingOffset < 0 || startingOffset > serializedData.length) {
            throw new Error('Invalid input: startingOffset must be a valid position in the serializedData');
        }

        const message = new Message();
        let offset = startingOffset;

        // Deserialize the count of tag-value pairs
        const deserializedCount = LengthDelimitedString.deserialize(serializedData.slice(offset));
        offset += deserializedCount.offset;
        const count = parseInt(deserializedCount.str || '0', 10);

        // Deserialize tag-value pairs based on the count
        for (let i = 0; i < count; i++) {
            const deserializedTag = LengthDelimitedString.deserialize(serializedData.slice(offset));
            offset += deserializedTag.offset;

            const deserializedValue = LengthDelimitedString.deserialize(serializedData.slice(offset));
            offset += deserializedValue.offset;

            if (deserializedTag.str === null || deserializedValue.str === null) {
                break;
            }

            message.set(deserializedTag.str, deserializedValue.str);
        }

        return {message, offset};
    }

    public set(tag: string, value: string): void {
        if (typeof tag !== 'string' || tag.length === 0 || typeof value !== 'string' || value.length === 0) {
            throw new Error('Invalid input: tag and value must be non-empty strings');
        }
        this.data.set(tag, value);
    }

    public get(tag: string): string | undefined {
        return this.data.get(tag);
    }

    public serialize(): string {
        const count = this.data.size;
        const serializedCount = LengthDelimitedString.serialize(count.toString());

        let serializedData = '';
        for (const [tag, value] of this.data.entries()) {
            const serializedTag = LengthDelimitedString.serialize(tag);
            const serializedValue = LengthDelimitedString.serialize(value);
            serializedData += (serializedTag + serializedValue);
        }

        return serializedCount + serializedData;
    }
}