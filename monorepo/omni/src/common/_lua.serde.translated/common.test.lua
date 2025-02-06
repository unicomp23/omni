local common = require "common"
local LengthDelimitedString = common.LengthDelimitedString

describe("LengthDelimitedString", function()
    describe("serialize", function()
        it("should serialize a valid string", function()
            local input = "Hello World"
            local expectedOutput = "(000B)Hello World"
            local serialized = LengthDelimitedString.serialize(input)
            assert.are.equal(expectedOutput, serialized)
        end)

        it("should throw an error for an empty string", function()
            local function callSerializeWithEmptyString()
                LengthDelimitedString.serialize("")
            end
            assert.has_error(callSerializeWithEmptyString, "Invalid input: str must be a non-empty string")
        end)
    end)

    describe("deserialize", function()
        it("should deserialize a valid serialized string", function()
            local input = "(000B)Hello World"
            local expectedOutput = {str = "Hello World", offset = 17}
            local deserialized = LengthDelimitedString.deserialize(input)
            assert.are.same(expectedOutput, deserialized)
        end)
    end)
end)

local PathArray = common.PathArray

describe("PathArray", function()
    describe("fromArray", function()
        it("should create a PathArray from a regular array", function()
            local input = { "first", "second", "third" }
            local pathArray = PathArray.fromArray(input)
            assert.are.same(input, pathArray)
        end)
    end)

    describe("serialize", function()
        it("should serialize a PathArray", function()
            local input = PathArray.fromArray({ "first", "second", "third" })
            local expectedOutput = "(0005)first(0006)second(0005)third"
            local serialized = PathArray.serialize(input)
            assert.are.equal(expectedOutput, serialized)
        end)
    end)

    describe("deserialize", function()
        it("should deserialize a serialized PathArray", function()
            local input = "(0005)first(0006)second(0005)third"
            local startingOffset = 0
            local expectedOutput = { pathArray = PathArray.fromArray({ "first", "second", "third" }), offset = 29 }
            local result = PathArray.deserialize(input, startingOffset)
            assert.are.same(expectedOutput, result)
        end)
    end)
end)

local Message = common.Message

describe("Message", function()
    local message

    before_each(function()
        message = Message.new()
    end)

    it("should set and get values", function()
        message:set("tag1", "value1")
        local value = message:get("tag1")
        assert.are.equal(value, "value1")
    end)

    it("should serialize and deserialize a message", function()
        message:set("tag1", "value1")
        message:set("tag2", "value2")

        local serialized = message:serialize()

        local deserializedResult = Message.deserialize(serialized)
        local deserializedMessage = deserializedResult.message
        local deserializedOffset = deserializedResult.offset

        assert.are.equal(deserializedMessage:get("tag1"), "value1")
        assert.are.equal(deserializedMessage:get("tag2"), "value2")
        assert.are.equal(deserializedOffset, #serialized)
    end)
end)
