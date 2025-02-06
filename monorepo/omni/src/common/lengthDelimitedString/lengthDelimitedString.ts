export class LengthDelimitedString {
    public static serialize(str: string): string {
        if (typeof str !== 'string' || str.length === 0) {
            throw new Error('Invalid input: str must be a non-empty string');
        }

        if (str.length > 0xFFFF) {
            throw new Error('Input too long: Maximum length is 65,535 characters');
        }

        const lengthStr = `(${str.length.toString(16).padStart(4, '0').toUpperCase()})`;

        return lengthStr + str;
    }

    public static deserialize(serialized: string): { str: string | null; offset: number } {
        if (typeof serialized !== 'string' || serialized.length === 0) {
            throw new Error('Invalid input: serialized must be a non-empty string');
        }

        if (serialized.length < 6 || serialized[0] !== '(' || serialized[5] !== ')') {
            throw new Error('Incomplete length delimiter');
        }

        for (let i = 1; i < 5; i++) {
            const char = serialized[i];
            if (!/[0-9a-fA-F]/.test(char)) {
                throw new Error(`Invalid hex digit at index ${i}: ${char}`);
            }
        }

        const length = parseInt(serialized.slice(1, 5).toUpperCase(), 16);

        if (serialized.length - 6 < length) {
            throw new Error('Incomplete string data');
        }

        const str = serialized.slice(6, 6 + length);
        const offset = 6 + length;

        return {str, offset};
    }
}