export class runner {
    private readonly run: () => Promise<boolean>;

    private constructor(callback: () => Promise<boolean>) {
        this.run = callback;
        this.run();
    }
    public static create(callback: () => Promise<boolean>) {
        return new runner(callback);
    }
}
