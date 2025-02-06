import {LengthDelimitedString} from "../lengthDelimitedString/lengthDelimitedString";

type Property = {
    tag: string;
    value: string;
};

export class PropertyPath {
    private data: Property[];

    constructor() {
        this.data = [];
    }

    public static deserialize(serializedData: string, startingOffset: number = 0): {
        propertyPath: PropertyPath;
        offset: number
    } {
        if (typeof serializedData !== "string" || serializedData.length === 0) {
            throw new Error("Invalid input: serializedData must be a non-empty string");
        }

        if (typeof startingOffset !== "number" || startingOffset < 0 || startingOffset > serializedData.length) {
            throw new Error("Invalid input: startingOffset must be a valid position in the serializedData");
        }

        const propertyPath = new PropertyPath();
        let offset = startingOffset;

        // Deserialize the count of tag-value pairs
        const deserializedCount = LengthDelimitedString.deserialize(serializedData.slice(offset));
        offset += deserializedCount.offset;
        const count = parseInt(deserializedCount.str || "0", 10);

        // Deserialize tag-value pairs based on the count
        for (let i = 0; i < count; i++) {
            const deserializedTag = LengthDelimitedString.deserialize(serializedData.slice(offset));
            offset += deserializedTag.offset;

            const deserializedValue = LengthDelimitedString.deserialize(serializedData.slice(offset));
            offset += deserializedValue.offset;

            if (deserializedTag.str === null || deserializedValue.str === null) {
                break;
            }

            propertyPath.set(deserializedTag.str, deserializedValue.str);
        }

        return {propertyPath, offset};
    }

    public set(tag: string, value: string): void {
        if (typeof tag !== "string" || tag.length === 0 || typeof value !== "string" || value.length === 0) {
            throw new Error("Invalid input: tag and value must be non-empty strings");
        }
        const index = this.data.findIndex((property) => property.tag === tag);
        if (index >= 0) {
            this.data[index].value = value;
        } else {
            this.data.push({tag, value});
        }
    }

    public get(tag: string): string | undefined {
        const property = this.data.find((property) => property.tag === tag);
        return property?.value;
    }

    public serialize(): string {
        const count = this.data.length;
        const serializedCount = LengthDelimitedString.serialize(count.toString());

        let serializedData = "";
        for (const property of this.data) {
            const serializedTag = LengthDelimitedString.serialize(property.tag);
            const serializedValue = LengthDelimitedString.serialize(property.value);
            serializedData += serializedTag + serializedValue;
        }

        return serializedCount + serializedData;
    }

    public getByIndex(index: number): { tag: string, value: string } | undefined {
        if (index >= 0 && index < this.data.length) {
            return this.data[index];
        }
        return undefined;
    }
}