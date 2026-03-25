import { createServerFn } from "@tanstack/react-start";
import { translateSpeechRequest } from "#/server/translate/request";

export const translateSpeech = createServerFn({ method: "POST" })
	.inputValidator((data) => {
		if (!(data instanceof FormData)) {
			throw new Error("Expected FormData");
		}
		return data;
	})
	.handler(({ data }) => {
		return translateSpeechRequest(data);
	});
