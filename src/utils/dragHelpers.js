export async function buildDocxPayload(files = []) {
  const docxFiles = files.filter((f) => f.name?.toLowerCase().endsWith('.docx'));
  return Promise.all(
    docxFiles.map(async (file) => ({
      name: file.name,
      data: await file.arrayBuffer(),
    })),
  );
}
