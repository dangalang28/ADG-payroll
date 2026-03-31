import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Dynamically import so Next.js treats it as a server-side module
    const { default: pdfParse } = await import("pdf-parse");
    const data = await pdfParse(buffer);

    return NextResponse.json({ text: data.text, pages: data.numpages });
  } catch (e) {
    console.error("PDF parse error:", e);
    // Always return JSON — never let Next.js return an HTML error page
    return NextResponse.json(
      { error: "Failed to parse PDF: " + e.message },
      { status: 500 }
    );
  }
}
