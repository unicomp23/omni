import {LengthDelimitedString} from "./lengthDelimitedString";

describe('LengthDelimitedString', () => {
    // Test serializing valid strings
    it('should serialize a valid string', () => {
        const input = 'Hello, world!';
        const expected = '(000D)Hello, world!';
        expect(LengthDelimitedString.serialize(input)).toBe(expected);
    });

    // Test deserializing a valid serialized string
    it('should deserialize a valid serialized string', () => {
        const input = '(000D)Hello, world!';
        const expected = {str: 'Hello, world!', offset: 13 + 6};
        expect(LengthDelimitedString.deserialize(input)).toEqual(expected);
    });

    // Test handling of empty input strings for serialization
    it('should throw an error for empty input strings', () => {
        expect(() => LengthDelimitedString.serialize('')).toThrowError('Invalid input: str must be a non-empty string');
    });

    // Test handling of non-string input for serialization
    it('should throw an error for non-string input', () => {
        // @ts-ignore
        expect(() => LengthDelimitedString.serialize(42)).toThrowError('Invalid input: str must be a non-empty string');
    });

    // Test handling of long strings for serialization
    it('should throw an error for long input strings', () => {
        const longString = 'a'.repeat(0xFFFF + 1);
        expect(() => LengthDelimitedString.serialize(longString)).toThrowError('Input too long: Maximum length is 65,535 characters');
    });

    // Test handling of invalid serialized strings for deserialization
    it('should throw an error for invalid serialized strings', () => {
        expect(() => LengthDelimitedString.deserialize('(000G)Hello, world!')).toThrowError('Invalid hex digit at index 4: G');
    });

    // Test handling of incomplete length delimiter for deserialization
    it('should throw an error for incomplete length delimiter', () => {
        expect(() => LengthDelimitedString.deserialize('(00D')).toThrowError('Incomplete length delimiter');
    });

    // Test handling of empty serialized strings for deserialization
    it('should throw an error for empty serialized strings', () => {
        expect(() => LengthDelimitedString.deserialize('')).toThrowError('Invalid input: serialized must be a non-empty string');
    });

    // Test handling of incomplete string data for deserialization
    it('should throw an error for incomplete string data', () => {
        expect(() => LengthDelimitedString.deserialize('(000E)Hello, worl')).toThrowError('Incomplete string data');
    });

    // Test deserializing a concatenated serialized string
    it('should deserialize a concatenated serialized string', () => {
        const input1 = 'Hello, world!';
        const input2 = 'LengthDelimitedString';
        const concatenated = LengthDelimitedString.serialize(input1) + LengthDelimitedString.serialize(input2);

        const deserialized1 = LengthDelimitedString.deserialize(concatenated);
        expect(deserialized1.str).toBe(input1);

        const deserialized2 = LengthDelimitedString.deserialize(concatenated.slice(deserialized1.offset));
        expect(deserialized2.str).toBe(input2);
    });
});