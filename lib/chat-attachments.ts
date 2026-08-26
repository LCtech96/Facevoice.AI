export type ChatAttachment = {
  mimeType: string
  data: string
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function filesToAttachments(
  files: Array<{ file: File; type: string }>
): Promise<ChatAttachment[]> {
  const attachments: ChatAttachment[] = []

  for (const item of files) {
    if (!item.file.type.startsWith('image/')) continue

    const data = await fileToBase64(item.file)
    attachments.push({
      mimeType: item.file.type || 'image/png',
      data,
    })
  }

  return attachments
}

export function dataUrlToAttachment(dataUrl: string, mimeType = 'image/png'): ChatAttachment {
  return {
    mimeType,
    data: dataUrl.replace(/^data:[^;]+;base64,/, ''),
  }
}
