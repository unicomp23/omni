import {AirCoreCoordinate} from "../proto/generated/devinternal_pb";

console.log("running")

const coord = new AirCoreCoordinate({
    kafkaTopic: "some.topic"
});

const bytes = coord.toBinary();
const coord_2 = AirCoreCoordinate.fromBinary(bytes);

console.log(`out: ${coord_2.kafkaTopic}`);
