// Type definitions
type SimpleFieldType = {
    kind: "string" | "int" | "bool";
    name: string;
};

type MessageField = {
    kind: "message";
    name: string;
    message: MessageType;
};

type EnumField = {
    kind: "enum";
    name: string;
    message: EnumType;
};

type Field = SimpleFieldType | MessageField | EnumField;

interface MessageType {
    kind: "message";
    name: string;
    fields: Field[];
}

interface EnumType {
    kind: "enum";
    name: string;
    values: string[];
}

// Utility function to capitalize the first letter of a string
const capitalize = (str: string): string => {
    return str.charAt(0).toUpperCase() + str.slice(1);
};

// Validation functions
const validateInt = (value: any): boolean => {
    return Number.isInteger(value);
};

const validateBool = (value: any): boolean => {
    return typeof value === "boolean";
};

const validateEnum = (enumType: EnumType, value: any): boolean => {
    return enumType.values.includes(value);
};

// Code generator functions
const generateClasses = (namespace: string, messageType: MessageType): string => {
    const fieldTypeResolver = (field: Field): string => {
        switch (field.kind) {
            case "int":
            case "bool":
            case "string":
                return field.kind;
            case "message":
                return `${namespace}.${field.message.name}`;
            case "enum":
                return `${namespace}.${field.message.name}`;
            default:
                return "unknown";
        }
    };

    const className = `${namespace}.${messageType.name}`;

    const serdeMethods: string[] = [];
    const deepMergeMethods: string[] = [];

    messageType.fields.forEach((field) => {
        const capitalizeFieldName = capitalize(field.name);

        // Generate serde methods
        switch (field.kind) {
            case "int":
                serdeMethods.push(`        if (!validateInt(this.${field.name})) throw new Error("Invalid field value: ${field.name}");`);
                deepMergeMethods.push(`        if (partial.${field.name} !== undefined && validateInt(partial.${field.name})) this.${field.name} = partial.${field.name};`);
                break;
            case "bool":
                serdeMethods.push(`        if (!validateBool(this.${field.name})) throw new Error("Invalid field value: ${field.name}");`);
                deepMergeMethods.push(`        if (partial.${field.name} !== undefined && validateBool(partial.${field.name})) this.${field.name} = partial.${field.name};`);
                break;
            case "message":
                serdeMethods.push(`        this.${field.name} = ${namespace}.${(field as MessageField).message.name}.deserialize(input.${field.name});`);
                deepMergeMethods.push(`        if (partial.${field.name} !== undefined) this.${field.name}.deepMerge(partial.${field.name});`);
                break;
            case "enum":
                serdeMethods.push(`        if (!validateEnum(${namespace}.${(field as EnumField).message.name}, this.${field.name})) throw new Error("Invalid field value: ${field.name}");`);
                deepMergeMethods.push(`        if (partial.${field.name} !== undefined && validateEnum(${namespace}.${(field as EnumField).message.name}, partial.${field.name})) this.${field.name} = partial.${field.name};`);
                break;
        }
    });

    const classContent = `
class ${className} implements ${messageType.name} {
    ${messageType.fields.map(field => `    public ${field.name}: ${fieldTypeResolver(field)};`).join("\n")}

    constructor(input: Partial<${messageType.name}> = {}) {
        Object.assign(this, input);
    }

    public static deserialize(input: any): ${messageType.name} {
        if (typeof input !== "object") throw new Error("Invalid input for ${messageType.name}.deserialize()");

        const instance = new ${className}(input);

${serdeMethods.join("\n")}

        return instance;
    }

    public static serialize(instance: ${messageType.name}): any {
        const serialObj: any = {};

${messageType.fields.map(field => `        serialObj.${field.name} = instance.${field.name};`).join("\n")}

        return serialObj;
    }

    public deepMerge(partial: Partial<${messageType.name}>): this {
        if (typeof partial !== "object") throw new Error("Invalid input for ${messageType.name}.deepMerge()");

${deepMergeMethods.join("\n")}

        return this;
    }
}

${namespace}.${messageType.name} = ${className};
return classContent;
`;

    return classContent;
};

/// Examples
const Address: MessageType = {
    kind: "message",
    name: "Address",
    fields: [
        { kind: "string", name: "street" },
        { kind: "string", name: "city" },
    ],
};

const Gender: EnumType = {
    kind: "enum",
    name: "Gender",
    values: ["Male", "Female"],
};

const User: MessageType = {
    kind: "message",
    name: "User",
    fields: [
        { kind: "string", name: "firstName" },
        { kind: "string", name: "lastName" },
        {
            kind: "message",
            name: "homeAddress",
            message: Address,
        },
        {
            kind: "message",
            name: "workAddress",
            message: Address,
        },
        {
            kind: "enum",
            name: "gender",
            message: Gender,
        },
    ],
};

console.log(generateClasses("myns", User));