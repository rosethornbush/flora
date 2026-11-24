import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const weather = createTool({
  id: "weather",
  description:
    "Weather via wttr.in for city, airport code or landmark. Default: current; forecast/hourly/astronomy when needed. Use known owner location or ask; never infer from server IP. Forecast: three days, three-hour intervals.",
  inputSchema: z.object({
    location: z.string().min(1),
    detail: z.enum(["current", "forecast", "hourly", "astronomy"]).default("current"),
    units: z.enum(["us", "metric", "metric_ms"]).optional(),
  }),
  execute: async ({ location, detail, units }, context) => {
    const query = new URLSearchParams({
      format: detail === "current" ? "%l: %C, %t (feels %f), wind %w, humidity %h" : "j1",
    });
    if (units) query.set({ us: "u", metric: "m", metric_ms: "M" }[units], "");
    const request = async (host: string) => {
      const response = await fetch(`https://${host}/${encodeURIComponent(location)}?${query}`, {
        signal: context?.abortSignal
          ? AbortSignal.any([context.abortSignal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Weather returned HTTP ${response.status}`);
      return response;
    };
    let response;
    try {
      response = await request("wttr.in");
    } catch {
      context?.abortSignal?.throwIfAborted();
      response = await request("wttr.is");
    }
    if (detail === "current") return { text: await response.text(), url: response.url };
    const data = z
      .object({
        weather: z.array(
          z.object({
            date: z.string(),
            mintempC: z.string(),
            mintempF: z.string(),
            maxtempC: z.string(),
            maxtempF: z.string(),
            astronomy: z.array(z.record(z.string(), z.string())),
            hourly: z.array(
              z.object({
                time: z.string(),
                tempC: z.string(),
                tempF: z.string(),
                weatherDesc: z.array(z.object({ value: z.string() })),
                chanceofrain: z.string(),
                humidity: z.string(),
                windspeedKmph: z.string(),
                windspeedMiles: z.string(),
              }),
            ),
          }),
        ),
      })
      .parse(await response.json());
    return {
      location,
      url: response.url,
      days: data.weather.map((day) => {
        if (detail === "astronomy") return { date: day.date, astronomy: day.astronomy };
        if (detail === "forecast")
          return {
            date: day.date,
            minC: day.mintempC,
            maxC: day.maxtempC,
            minF: day.mintempF,
            maxF: day.maxtempF,
            conditions: day.hourly.map((hour) => ({
              time: hour.time,
              description: hour.weatherDesc,
              chanceofrain: hour.chanceofrain,
            })),
          };
        return {
          date: day.date,
          hourly: day.hourly,
        };
      }),
    };
  },
});
