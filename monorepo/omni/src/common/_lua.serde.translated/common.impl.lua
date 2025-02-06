local module = {}

local function serializeLengthDelimitedString(str)
    if type(str) ~= 'string' or str:len() == 0 then
        error('Invalid input: str must be a non-empty string')
    end

    if str:len() > 0xFFFF then
        error('Input too long: Maximum length is 65,535 characters')
    end

    local lengthStr = string.format('(%04X)', str:len())

    return lengthStr .. str
end

local function deserializeLengthDelimitedString(serialized)
    if type(serialized) ~= 'string' or serialized:len() == 0 then
        error('Invalid input: serialized must be a non-empty string')
    end

    if serialized:len() < 6 or serialized:sub(1, 1) ~= '(' or serialized:sub(6, 6) ~= ')' then
        error('Incomplete length delimiter')
    end

    local length = tonumber(serialized:sub(2, 4), 16)
    if serialized:len() - 6 < length then
        error('Incomplete string data')
    end

    local str = serialized:sub(7, 6 + length)
    local offset = 6 + length

    return str, offset
end

local function serializePathArray(pathArray)
    local serializedPaths = {}
    for _, path in ipairs(pathArray) do
        table.insert(serializedPaths, serializeLengthDelimitedString(path))
    end
    return table.concat(serializedPaths)
end

local function deserializePathArray(serializedData, startingOffset)
    local offset = startingOffset or 0
    local pathArray = {}

    while offset < serializedData:len() do
        local deserializedPath, deserializedOffset = deserializeLengthDelimitedString(serializedData:sub(offset + 1))
        offset = offset + deserializedOffset

        table.insert(pathArray, deserializedPath)
    end

    return pathArray, offset
end

local function deserializeMessage(serializedData, startingOffset)
    local offset = startingOffset or 0
    local messageData = {}

    local deserializedCount, deserializedOffset = deserializeLengthDelimitedString(serializedData:sub(offset + 1))
    offset = offset + deserializedOffset
    local count = tonumber(deserializedCount)

    for _ = 1, count do
        local deserializedTag, tagOffset = deserializeLengthDelimitedString(serializedData:sub(offset + 1))
        offset = offset + tagOffset

        local deserializedValue, valueOffset = deserializeLengthDelimitedString(serializedData:sub(offset + 1))
        offset = offset + valueOffset

        messageData[deserializedTag] = deserializedValue
    end

    return messageData, offset
end

function module.serializeLengthDelimitedString(str)
    return serializeLengthDelimitedString(str)
end

function module.deserializeLengthDelimitedString(serialized)
    return deserializeLengthDelimitedString(serialized)
end

function module.serializePathArray(pathArray)
    return serializePathArray(pathArray)
end

function module.deserializePathArray(serializedData, startingOffset)
    return deserializePathArray(serializedData, startingOffset)
end

function module.deserializeMessage(serializedData, startingOffset)
    return deserializeMessage(serializedData, startingOffset)
end

return module
