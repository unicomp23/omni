#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ShastaCdkStackL1 } from '../lib/shasta-cdk-stack';
import { ShastaCdkStackL2 } from '../lib/shasta-cdk-stack-layer2';
import { ShastaRedpandaStack } from '../lib/shasta-redpanda-stack';

const env = {
    // calent: 060795946368
    // eng: 358474168551
    account: "358474168551",
    region: 'us-east-1'
};

const app = new cdk.App();

console.log(env);

// dev env 1
{
    const shastaCdkStackL1 = new ShastaCdkStackL1(app, 'ShastaCdkStackL1', {
        env
    });

    const shastaCdkStackL2 = new ShastaCdkStackL2(app, 'ShastaCdkStackL2', {
        env
    });

    const shastaRedpandaStack = new ShastaRedpandaStack(app, 'ShastaRedpandaStack', {
        env
    });

    shastaCdkStackL2.addDependency(shastaCdkStackL1);
}
