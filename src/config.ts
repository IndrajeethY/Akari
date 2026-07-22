class Config {
	public readonly token: string;
	public readonly dbString: string;

	constructor() {
		this.token = Deno.env.get("TOKEN") ?? "";
		this.dbString = Deno.env.get("DB_STRING") ?? "database.db";

		if (!this.token) {
			throw new Error(
				"TOKEN is not set. Add it to your .env file (see README).",
			);
		}
	}
}

export default Config;
