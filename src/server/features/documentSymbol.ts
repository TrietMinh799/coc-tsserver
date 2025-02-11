/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { TextDocument } from 'coc.nvim'
import { DocumentSymbolProvider } from 'coc.nvim'
import { CancellationToken, DocumentSymbol, Range, SymbolKind, SymbolTag } from 'vscode-languageserver-protocol'
import * as Proto from '../protocol'
import * as PConst from '../protocol.const'
import { ITypeScriptServiceClient } from '../typescriptService'
import * as typeConverters from '../utils/typeConverters'

const getSymbolKind = (kind: string): SymbolKind => {
  switch (kind) {
    case PConst.Kind.module:
      return SymbolKind.Module
    case PConst.Kind.class:
      return SymbolKind.Class
    case PConst.Kind.enum:
      return SymbolKind.Enum
    case PConst.Kind.interface:
      return SymbolKind.Interface
    case PConst.Kind.method:
      return SymbolKind.Method
    case PConst.Kind.memberVariable:
      return SymbolKind.Property
    case PConst.Kind.memberGetAccessor:
      return SymbolKind.Property
    case PConst.Kind.memberSetAccessor:
      return SymbolKind.Property
    case PConst.Kind.variable:
      return SymbolKind.Variable
    case PConst.Kind.const:
      return SymbolKind.Variable
    case PConst.Kind.localVariable:
      return SymbolKind.Variable
    case PConst.Kind.variable:
      return SymbolKind.Variable
    case PConst.Kind.constructSignature:
    case PConst.Kind.constructorImplementation:
    case PConst.Kind.function:
    case PConst.Kind.localFunction:
      return SymbolKind.Function
  }
  return SymbolKind.Variable
}

export default class TypeScriptDocumentSymbolProvider implements DocumentSymbolProvider {
  public constructor(private readonly client: ITypeScriptServiceClient) {}

  public async provideDocumentSymbols(
    resource: TextDocument,
    token: CancellationToken
  ): Promise<DocumentSymbol[]> {
    const filepath = this.client.toPath(resource.uri)
    if (!filepath) return []

    const args: Proto.FileRequestArgs = {
      file: filepath
    }

    try {
      const response = await this.client.execute('navtree', args, token)
      if (response.type == 'response' && response.body) {
        // The root represents the file. Ignore this when showing in the UI
        const tree = response.body
        if (tree.childItems) {
          const result = new Array<DocumentSymbol>()
          tree.childItems.forEach(item =>
            TypeScriptDocumentSymbolProvider.convertNavTree(
              result,
              item
            )
          )
          return result
        }
      }
      return []
    } catch (e) {
      return []
    }
  }

  private static convertNavTree(
    output: DocumentSymbol[],
    item: Proto.NavigationTree,
  ): boolean {
    let shouldInclude = TypeScriptDocumentSymbolProvider.shouldInclueEntry(item)
    const children = new Set(item.childItems || [])
    for (const span of item.spans) {
      const range = typeConverters.Range.fromTextSpan(span)
      const symbolInfo = TypeScriptDocumentSymbolProvider.convertSymbol(item, range)
      if (children.size) symbolInfo.children = []

      for (const child of children) {
        if (child.spans.some(span => !!containsRange(range, typeConverters.Range.fromTextSpan(span)))) {
          const includedChild = TypeScriptDocumentSymbolProvider.convertNavTree(symbolInfo.children, child)
          shouldInclude = shouldInclude || includedChild
          children.delete(child)
        }
      }

      if (shouldInclude) {
        output.push(symbolInfo)
      }
    }
    return shouldInclude
  }

  private static convertSymbol(item: Proto.NavigationTree, range: Range): DocumentSymbol {
    const selectionRange = item.nameSpan ? typeConverters.Range.fromTextSpan(item.nameSpan) : range
    let label = item.text
    switch (item.kind) {
      case PConst.Kind.memberGetAccessor: label = `(get) ${label}`; break
      case PConst.Kind.memberSetAccessor: label = `(set) ${label}`; break
    }
    const symbolInfo = DocumentSymbol.create(
      label,
      '',
      getSymbolKind(item.kind),
      range,
      containsRange(range, selectionRange) ? selectionRange : range)

    const kindModifiers = parseKindModifier(item.kindModifiers)
    if (kindModifiers.has(PConst.KindModifiers.deprecated)) {
      symbolInfo.tags = [SymbolTag.Deprecated]
    }
    return symbolInfo
  }

  private static shouldInclueEntry(
    item: Proto.NavigationTree | Proto.NavigationBarItem
  ): boolean {
    if (item.kind === PConst.Kind.alias) {
      return false
    }
    return !!(
      item.text &&
      item.text !== '<function>' &&
      item.text !== '<class>'
    )
  }
}

function containsRange(range: Range, otherRange: Range): boolean {
  if (otherRange.start.line < range.start.line || otherRange.end.line < range.start.line) {
    return false
  }
  if (otherRange.start.line > range.end.line || otherRange.end.line > range.end.line) {
    return false
  }
  if (otherRange.start.line === range.start.line && otherRange.start.character < range.start.character) {
    return false
  }
  if (otherRange.end.line === range.end.line && otherRange.end.character > range.end.character) {
    return false
  }
  return true
}

function parseKindModifier(kindModifiers: string): Set<string> {
  return new Set(kindModifiers.split(/,|\s+/g))
}
