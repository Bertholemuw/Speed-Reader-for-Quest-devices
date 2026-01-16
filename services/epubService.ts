
import JSZip from 'jszip';

export const extractTextFromEpub = async (file: File | Blob): Promise<{ title: string; content: string }> => {
  const zip = await JSZip.loadAsync(file);
  
  // 1. Find the container.xml to get the path to the .opf file
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("Invalid EPUB: Missing container.xml");

  const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
  const opfPath = opfPathMatch ? opfPathMatch[1] : "";
  if (!opfPath) throw new Error("Invalid EPUB: Could not find OPF path");

  // 2. Load the OPF file
  const opfContent = await zip.file(opfPath)?.async("string");
  if (!opfContent) throw new Error("Invalid EPUB: Could not load OPF content");

  const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
  const parser = new DOMParser();
  const opfDoc = parser.parseFromString(opfContent, "text/xml");

  // Get Title
  const title = opfDoc.querySelector("title")?.textContent || opfDoc.querySelector("dc\\:title")?.textContent || "Untitled Book";

  // 3. Get the spine order
  const manifestItems: Record<string, string> = {};
  opfDoc.querySelectorAll("manifest > item").forEach(item => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifestItems[id] = href;
  });

  const spineRefs = Array.from(opfDoc.querySelectorAll("spine > itemref")).map(ref => ref.getAttribute("idref"));

  // 4. Extract text from each item in the spine
  let fullContent = "";
  for (const idref of spineRefs) {
    if (!idref) continue;
    const href = manifestItems[idref];
    if (!href) continue;

    // Construct correct path inside zip
    const itemPath = opfDir ? `${opfDir}/${href}` : href;
    const htmlContent = await zip.file(itemPath)?.async("string");
    
    if (htmlContent) {
      const htmlDoc = parser.parseFromString(htmlContent, "text/html");
      // Basic text extraction - remove scripts, styles, etc.
      const body = htmlDoc.body;
      if (body) {
        // Simple heuristic: get text content and clean whitespace
        const text = body.innerText || body.textContent || "";
        fullContent += text + "\n\n";
      }
    }
  }

  return { title, content: fullContent.trim() };
};
