import { NextResponse } from "next/server";
import { z } from "zod";

import { generateRiskAssessment } from "@/lib/risk-engine";

export const runtime = "nodejs";

const payloadSchema = z.object({
  address: z
    .string()
    .trim()
    .min(5, "Please enter a complete address or ZIP code.")
    .max(200, "Address is too long."),
});

export async function POST(request: Request) {
  try {
    const payload = payloadSchema.parse(await request.json());
    const response = await generateRiskAssessment(payload.address);

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    console.error("ClimateGuard risk route failed", error);

    return NextResponse.json(
      {
        error:
          "We could not score this location right now. Try another address or check your API configuration.",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "ClimateGuard risk API",
    timestamp: new Date().toISOString(),
  });
}
