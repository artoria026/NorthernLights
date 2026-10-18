import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileDropZone } from './FileDropZone'

const xlsx = new File(['x'], 'lote.XLSX')
const pdf = new File(['x'], 'estado.pdf')

function setup(disabled = false) {
  const onFile = vi.fn()
  render(
    <FileDropZone
      accept=".xlsx"
      acceptedExtensions={['.xlsx']}
      disabled={disabled}
      title="Arrastra aquí tu archivo"
      rejectedMessage="Solo .xlsx"
      onFile={onFile}
    />,
  )
  return onFile
}

const drop = (el: HTMLElement, file: File) => {
  const event = createEvent.drop(el)
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
  fireEvent(el, event)
}

describe('FileDropZone', () => {
  it('gives back the file that is dropped on it, whatever the case of its extension', () => {
    const onFile = setup()
    drop(screen.getByRole('button'), xlsx)
    expect(onFile).toHaveBeenCalledWith(xlsx)
  })

  it('gives back the file that is picked with the dialog', () => {
    const onFile = setup()
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [xlsx] } })
    expect(onFile).toHaveBeenCalledWith(xlsx)
  })

  it('refuses another kind of file and says why', () => {
    const onFile = setup()
    drop(screen.getByRole('button'), pdf)
    expect(onFile).not.toHaveBeenCalled()
    expect(screen.getByText('Solo .xlsx')).toBeInTheDocument()
  })

  it('does nothing while disabled', () => {
    const onFile = setup(true)
    drop(screen.getByRole('button'), xlsx)
    expect(onFile).not.toHaveBeenCalled()
  })
})
