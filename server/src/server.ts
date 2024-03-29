/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
} from 'vscode-languageserver/node';


import {
	Position,
	TextDocument
} from 'vscode-languageserver-textdocument';

import { WhileLexer } from './grammar/WhileLexer';
import { CharStreams, CommonTokenStream, Recognizer, RecognitionException, ANTLRErrorListener, CommonToken } from 'antlr4ts';
import { WhileParser } from './grammar/WhileParser';
import { count } from 'console';

type LspError = {
	syntaxError: boolean,
	startIndex: number,
	endIndex: number,
	message: string,
}

class LspParserErrorListener implements ANTLRErrorListener<any> {

	private static instance: LspParserErrorListener;

	public static getInstance(): LspParserErrorListener {
		if (!LspParserErrorListener.instance) {
			LspParserErrorListener.instance = new LspParserErrorListener();
		}

		return LspParserErrorListener.instance;
	}

	private constructor() { /*EMPTY*/ }

	private _errorList = new Array<LspError>();

	public syntaxError<T>(recognizer: Recognizer<T, any>, offendingSymbol: T, line: number, charPositionInLine: number, msg: string, e: RecognitionException | undefined): void {
		if (offendingSymbol instanceof CommonToken) {
			const _startIndex = offendingSymbol.startIndex;
			const _endIndex = offendingSymbol.stopIndex;
			this._errorList.push({ syntaxError: true, startIndex: _startIndex, endIndex: _endIndex, message: msg });
		} else if (!offendingSymbol) {
			// Dirty
			this._errorList.push({ syntaxError: false, startIndex: line, endIndex: charPositionInLine, message: msg });
		}
		return;
	}
	public get messages() {
		return this._errorList;
	}
	public clear() {
		this._errorList = [];
	}
}

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);
// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;
	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation

	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			},
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.

connection.onDidChangeConfiguration(change => {
	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});


// Only keep settings for open documents
documents.onDidClose(e => {
	// documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});


async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// In this simple example we get the settings for every validate run.
	// const settings = await getDocumentSettings(textDocument.uri);
	const errorListener = LspParserErrorListener.getInstance();
	errorListener.clear();

	const inputStream = CharStreams.fromString(textDocument.getText());
	const lexer = new WhileLexer(inputStream);
	lexer.addErrorListener(errorListener);

	const tokenStream = new CommonTokenStream(lexer);
	const parser = new WhileParser(tokenStream);
	parser.addErrorListener(errorListener);

	const tree = parser.prog();
	//console.log(errorLineNum);

	const diagnostics: Diagnostic[] = [];

	errorListener.messages.forEach((element) => {

		let range: { start: Position, end: Position };
		if (element.syntaxError) {
			range = {
				start: textDocument.positionAt(element.startIndex),
				end: textDocument.positionAt(element.endIndex)
			};
		} else {
			range = {
				start: { line: element.startIndex - 1, character: element.endIndex },
				end: { line: element.startIndex - 1, character: element.endIndex + 1 }
			};
		}

		const diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Error,

			range: {
				start: range.start,
				end: range.end
			},
			message: `Syntax Error: ${element.message}`,
			source: 'While Parser'
		};
		diagnostics.push(diagnostic);
	});


	/*let problems = 0;
	while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
		problems++;
		const diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Warning,
			range: {
				start: textDocument.positionAt(m.index),
				end: textDocument.positionAt(m.index + m[0].length)
			},
			message: `${m[0]} is all uppercase.`,
			source: 'ex'
		};
		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Spelling matters'
				},
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Particularly for names'
				}
			];
		}
		diagnostics.push(diagnostic);
	}*/

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.

		const voc = WhileLexer.VOCABULARY;
		return [
			{
				label: voc.getSymbolicName(WhileLexer.WRITE)!.toLowerCase(),
				kind: CompletionItemKind.Method,
				data: WhileLexer.WRITE,
				commitCharacters: ["("]
			},
			{
				label: voc.getSymbolicName(WhileLexer.READ)!.toLowerCase(),
				kind: CompletionItemKind.Method,
				data: WhileLexer.READ,
				commitCharacters: ["("]
			},
			{
				label: voc.getSymbolicName(WhileLexer.PRED)!.toLowerCase(),
				kind: CompletionItemKind.Method,
				data: WhileLexer.PRED,
				commitCharacters: ["("]
			},
			{
				label: voc.getSymbolicName(WhileLexer.SUCC)!.toLowerCase(),
				kind: CompletionItemKind.Method,
				data: WhileLexer.SUCC,
				commitCharacters: ["("]
			},
			{
				label: voc.getSymbolicName(WhileLexer.LOOP)!.toLowerCase(),
				kind: CompletionItemKind.Operator,
				data: WhileLexer.LOOP,
				commitCharacters: ["("]
			},
			{
				label: voc.getSymbolicName(WhileLexer.WHILE)!.toLowerCase(),
				kind: CompletionItemKind.Operator,
				data: WhileLexer.WHILE,
				commitCharacters: ["("]
			},
			{
				label: voc.getSymbolicName(WhileLexer.RETURN)!.toLowerCase(),
				kind: CompletionItemKind.Keyword,
				data: WhileLexer.RETURN
			},
			{
				label: voc.getSymbolicName(WhileLexer.DEFINE)!.toLowerCase(),
				kind: CompletionItemKind.Keyword,
				data: WhileLexer.DEFINE
			},
			{
				label: voc.getSymbolicName(WhileLexer.VARIABLE)!.toLowerCase(),
				kind: CompletionItemKind.Keyword,
				data: WhileLexer.VARIABLE
			},
			{
				label: voc.getSymbolicName(WhileLexer.BEGIN)!.toLowerCase(),
				kind: CompletionItemKind.Keyword,
				data: WhileLexer.BEGIN,
				commitCharacters: [":"]
			},
			{
				label: voc.getSymbolicName(WhileLexer.END)!.toLowerCase(),
				kind: CompletionItemKind.Keyword,
				data: WhileLexer.END
			},
		];
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (item.data === WhileLexer.WRITE) {
			item.detail = 'A Write Statement';
			item.documentation = 'Outputs Data On The Console';
		}
		if (item.data === WhileLexer.READ) {
			item.detail = 'A Read Statement';
			item.documentation = 'Will Read Input From The User';
		}
		if (item.data === WhileLexer.PRED) {
			item.detail = 'A Pred Statement';
			item.documentation = 'Will Decrement The Given Variable';
		}
		if (item.data === WhileLexer.SUCC) {
			item.detail = 'A Succ Statement';
			item.documentation = 'Will Increment The Given Variable';
		}
		return item;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
