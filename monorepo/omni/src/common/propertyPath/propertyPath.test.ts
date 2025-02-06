import {PropertyPath} from "./propertyPath";

describe("PropertyPath", () => {
    it("should add tag-value pairs", () => {
        const propertyPath = new PropertyPath();
        propertyPath.set("key", "value");

        expect(propertyPath.get("key")).toBe("value");
    });

    it("should override the value when adding an existing tag", () => {
        const propertyPath = new PropertyPath();
        propertyPath.set("key", "value");
        propertyPath.set("key", "newValue");

        expect(propertyPath.get("key")).toBe("newValue");
    });

    it("should return undefined when the tag is not found", () => {
        const propertyPath = new PropertyPath();
        propertyPath.set("key", "value");

        expect(propertyPath.get("nonExistentKey")).toBeUndefined();
    });

    it("should serialize and deserialize a PropertyPath, preserving its data", () => {
        const propertyPath = new PropertyPath();
        propertyPath.set("key", "value");
        propertyPath.set("anotherKey", "anotherValue");

        const serializedData = propertyPath.serialize();
        const {propertyPath: deserializedPropertyPath} = PropertyPath.deserialize(serializedData);

        expect(deserializedPropertyPath.get("key")).toBe("value");
        expect(deserializedPropertyPath.get("anotherKey")).toBe("anotherValue");
    });

    it("should throw an error when invalid input is provided for set method", () => {
        const propertyPath = new PropertyPath();

        expect(() => {
            propertyPath.set("", "value");
        }).toThrow("Invalid input: tag and value must be non-empty strings");

        expect(() => {
            propertyPath.set("key", "");
        }).toThrow("Invalid input: tag and value must be non-empty strings");
    });

    it("should throw an error when invalid input is provided for deserialize method", () => {
        expect(() => {
            PropertyPath.deserialize("", 1);
        }).toThrow("Invalid input: serializedData must be a non-empty string");

        expect(() => {
            PropertyPath.deserialize("non-empty string", -1);
        }).toThrow("Invalid input: startingOffset must be a valid position in the serializedData");

        expect(() => {
            PropertyPath.deserialize("non-empty string", 100);
        }).toThrow("Invalid input: startingOffset must be a valid position in the serializedData");
    });
});