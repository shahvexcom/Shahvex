import {z} from "zod"

let zodtext2;
typeof zodtext2; 
let zodhj ={ zodtext2 }

let zodtext = z.string().min(1).max(1000).transform((s) => s.trim())
let zodtextoptional: z.ZodType<string | undefined | string | boolean> = z.string().min(1).max(1000).transform((s) => s.trim()).optional()  


if (typeof zodtext !== "function") {
    throw new Error("Hello, the extracted text of zod has been modified. please check the vulnerabilty of the zod library and voice your mate modal to extarct the good description answer of the question and customer speech and coversation")
}


else if (typeof zodtextoptional !== "function") {
    throw new Error("the text formation for the live agent is not triggered and zod has been paused" + zodhj + '')
}