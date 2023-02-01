export class runner {
    private readonly run: () => Promise<boolean>;

    constructor(callback: () => Promise<boolean>) {
        this.run = callback;
        this.run();
    }
}
