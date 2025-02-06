import { PathArray } from "./pathArray";

describe("PathArray", () => {
    it("Should serialize and deserialize a path array with 3 segments", () => {
        const pathArray = new PathArray();
        pathArray.push("path1", "path2", "path3");

        const serializedPathArray = PathArray.serialize(pathArray);
        const expectedSerialization = "(0005)path1(0005)path2(0005)path3";
        // ^^^ ksortable for redis sorted set, don't have to worry about escape characters
        expect(serializedPathArray).toEqual(expectedSerialization);

        const { pathArray: deserializedPathArray } = PathArray.deserialize(serializedPathArray);

        for (let i = 0; i < pathArray.length; i++) {
            expect(deserializedPathArray[i]).toEqual(pathArray[i]);
        }
    });
});
