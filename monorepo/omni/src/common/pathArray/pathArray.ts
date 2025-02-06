import { LengthDelimitedString } from "../lengthDelimitedString/lengthDelimitedString";

export class PathArray extends Array<string> {
    public static fromArray(array: string[]): PathArray {
        const pathArray = new PathArray();
        pathArray.push(...array);
        return pathArray;
    }

    public static serialize(pathArray: PathArray): string {
        const serializedPaths = pathArray.map((path) => LengthDelimitedString.serialize(path)).join("");
        return serializedPaths;
    }

    public static deserialize(serializedData: string, startingOffset: number = 0): {
        pathArray: PathArray;
        offset: number;
    } {
        let offset = startingOffset;
        const pathArray = new PathArray();

        while (offset < serializedData.length) {
            const deserializedPath = LengthDelimitedString.deserialize(serializedData.slice(offset));
            offset += deserializedPath.offset;

            if (deserializedPath.str === null) {
                break;
            }

            pathArray.push(deserializedPath.str);
        }

        return { pathArray, offset };
    }

    public deserialize(serializedData: string, startingOffset: number = 0): {
        pathArray: PathArray;
        offset: number;
    } {
        this.length = 0;
        const result = PathArray.deserialize(serializedData, startingOffset);
        this.push(...result.pathArray);
        return result;
    }

    public serialize() {
        return PathArray.serialize(this);
    }

    public startsWith(pathArray: PathArray): boolean {
        if (this.length < pathArray.length) {
            return false;
        }

        for (let i = 0; i < pathArray.length; i++) {
            if (this[i] !== pathArray[i]) {
                return false;
            }
        }

        return true;
    }
}