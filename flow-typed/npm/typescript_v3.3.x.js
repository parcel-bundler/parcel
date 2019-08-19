// flow-typed signature: a73d5be820ce9376397c9110a4a02d9e
// flow-typed version: c6154227d1/typescript_v3.3.x/flow_>=v0.104.x

declare module "typescript" {
  declare var versionMajorMinor: "3.3"; // "3.3";
  declare var version: string;
  declare type MapLike<T> = { [index: string]: T, ... };

  declare class SortedReadonlyArray<T> extends $ReadOnlyArray<T> {
    __sortedArrayBrand: any
  }

  declare class SortedArray<T> extends Array<T> {
    __sortedArrayBrand: any
  }

  declare class ReadonlyMap<T> {
    get(key: string): T | void,
    has(key: string): boolean,
    forEach(action: (value: T, key: string) => void): void,
    +size: number,
    keys(): Iterator<string>,
    values(): Iterator<T>,
    entries(): Iterator<[string, T]>
  }

  declare class Map<T> extends ReadonlyMap<T> {
    set(key: string, value: T): this,
    delete(key: string): boolean,
    clear(): void
  }

  declare type Iterator<T> = { next():
    | {
    value: T,
    done: false,
    ...
  }
    | {
    value: empty,
    done: true,
    ...
  }, ... };

  declare type Push<T> = { push(...values: T[]): void, ... };

  declare type Path = string & { __pathBrand: any, ... };
  declare type TextRange = {
    pos: number,
    end: number,
    ...
  };

  declare type JsDocSyntaxKind =
    | typeof SyntaxKind.EndOfFileToken
    | typeof SyntaxKind.WhitespaceTrivia
    | typeof SyntaxKind.AtToken
    | typeof SyntaxKind.NewLineTrivia
    | typeof SyntaxKind.AsteriskToken
    | typeof SyntaxKind.OpenBraceToken
    | typeof SyntaxKind.CloseBraceToken
    | typeof SyntaxKind.LessThanToken
    | typeof SyntaxKind.OpenBracketToken
    | typeof SyntaxKind.CloseBracketToken
    | typeof SyntaxKind.EqualsToken
    | typeof SyntaxKind.CommaToken
    | typeof SyntaxKind.DotToken
    | typeof SyntaxKind.Identifier
    | typeof SyntaxKind.NoSubstitutionTemplateLiteral
    | typeof SyntaxKind.Unknown
    | KeywordSyntaxKind;
  declare type KeywordSyntaxKind =
    | typeof SyntaxKind.AbstractKeyword
    | typeof SyntaxKind.AnyKeyword
    | typeof SyntaxKind.AsKeyword
    | typeof SyntaxKind.BigIntKeyword
    | typeof SyntaxKind.BooleanKeyword
    | typeof SyntaxKind.BreakKeyword
    | typeof SyntaxKind.CaseKeyword
    | typeof SyntaxKind.CatchKeyword
    | typeof SyntaxKind.ClassKeyword
    | typeof SyntaxKind.ContinueKeyword
    | typeof SyntaxKind.ConstKeyword
    | typeof SyntaxKind.ConstructorKeyword
    | typeof SyntaxKind.DebuggerKeyword
    | typeof SyntaxKind.DeclareKeyword
    | typeof SyntaxKind.DefaultKeyword
    | typeof SyntaxKind.DeleteKeyword
    | typeof SyntaxKind.DoKeyword
    | typeof SyntaxKind.ElseKeyword
    | typeof SyntaxKind.EnumKeyword
    | typeof SyntaxKind.ExportKeyword
    | typeof SyntaxKind.ExtendsKeyword
    | typeof SyntaxKind.FalseKeyword
    | typeof SyntaxKind.FinallyKeyword
    | typeof SyntaxKind.ForKeyword
    | typeof SyntaxKind.FromKeyword
    | typeof SyntaxKind.FunctionKeyword
    | typeof SyntaxKind.GetKeyword
    | typeof SyntaxKind.IfKeyword
    | typeof SyntaxKind.ImplementsKeyword
    | typeof SyntaxKind.ImportKeyword
    | typeof SyntaxKind.InKeyword
    | typeof SyntaxKind.InferKeyword
    | typeof SyntaxKind.InstanceOfKeyword
    | typeof SyntaxKind.InterfaceKeyword
    | typeof SyntaxKind.IsKeyword
    | typeof SyntaxKind.KeyOfKeyword
    | typeof SyntaxKind.LetKeyword
    | typeof SyntaxKind.ModuleKeyword
    | typeof SyntaxKind.NamespaceKeyword
    | typeof SyntaxKind.NeverKeyword
    | typeof SyntaxKind.NewKeyword
    | typeof SyntaxKind.NullKeyword
    | typeof SyntaxKind.NumberKeyword
    | typeof SyntaxKind.ObjectKeyword
    | typeof SyntaxKind.PackageKeyword
    | typeof SyntaxKind.PrivateKeyword
    | typeof SyntaxKind.ProtectedKeyword
    | typeof SyntaxKind.PublicKeyword
    | typeof SyntaxKind.ReadonlyKeyword
    | typeof SyntaxKind.RequireKeyword
    | typeof SyntaxKind.GlobalKeyword
    | typeof SyntaxKind.ReturnKeyword
    | typeof SyntaxKind.SetKeyword
    | typeof SyntaxKind.StaticKeyword
    | typeof SyntaxKind.StringKeyword
    | typeof SyntaxKind.SuperKeyword
    | typeof SyntaxKind.SwitchKeyword
    | typeof SyntaxKind.SymbolKeyword
    | typeof SyntaxKind.ThisKeyword
    | typeof SyntaxKind.ThrowKeyword
    | typeof SyntaxKind.TrueKeyword
    | typeof SyntaxKind.TryKeyword
    | typeof SyntaxKind.TypeKeyword
    | typeof SyntaxKind.TypeOfKeyword
    | typeof SyntaxKind.UndefinedKeyword
    | typeof SyntaxKind.UniqueKeyword
    | typeof SyntaxKind.UnknownKeyword
    | typeof SyntaxKind.VarKeyword
    | typeof SyntaxKind.VoidKeyword
    | typeof SyntaxKind.WhileKeyword
    | typeof SyntaxKind.WithKeyword
    | typeof SyntaxKind.YieldKeyword
    | typeof SyntaxKind.AsyncKeyword
    | typeof SyntaxKind.AwaitKeyword
    | typeof SyntaxKind.OfKeyword;
  declare type JsxTokenSyntaxKind =
    | typeof SyntaxKind.LessThanSlashToken
    | typeof SyntaxKind.EndOfFileToken
    | typeof SyntaxKind.ConflictMarkerTrivia
    | typeof SyntaxKind.JsxText
    | typeof SyntaxKind.JsxTextAllWhiteSpaces
    | typeof SyntaxKind.OpenBraceToken
    | typeof SyntaxKind.LessThanToken;

  declare var SyntaxKind: {
    // 0
    +Unknown: 0,
    // 1
    +EndOfFileToken: 1,
    // 2
    +SingleLineCommentTrivia: 2,
    // 3
    +MultiLineCommentTrivia: 3,
    // 4
    +NewLineTrivia: 4,
    // 5
    +WhitespaceTrivia: 5,
    // 6
    +ShebangTrivia: 6,
    // 7
    +ConflictMarkerTrivia: 7,
    // 8
    +NumericLiteral: 8,
    // 9
    +BigIntLiteral: 9,
    // 10
    +StringLiteral: 10,
    // 11
    +JsxText: 11,
    // 12
    +JsxTextAllWhiteSpaces: 12,
    // 13
    +RegularExpressionLiteral: 13,
    // 14
    +NoSubstitutionTemplateLiteral: 14,
    // 15
    +TemplateHead: 15,
    // 16
    +TemplateMiddle: 16,
    // 17
    +TemplateTail: 17,
    // 18
    +OpenBraceToken: 18,
    // 19
    +CloseBraceToken: 19,
    // 20
    +OpenParenToken: 20,
    // 21
    +CloseParenToken: 21,
    // 22
    +OpenBracketToken: 22,
    // 23
    +CloseBracketToken: 23,
    // 24
    +DotToken: 24,
    // 25
    +DotDotDotToken: 25,
    // 26
    +SemicolonToken: 26,
    // 27
    +CommaToken: 27,
    // 28
    +LessThanToken: 28,
    // 29
    +LessThanSlashToken: 29,
    // 30
    +GreaterThanToken: 30,
    // 31
    +LessThanEqualsToken: 31,
    // 32
    +GreaterThanEqualsToken: 32,
    // 33
    +EqualsEqualsToken: 33,
    // 34
    +ExclamationEqualsToken: 34,
    // 35
    +EqualsEqualsEqualsToken: 35,
    // 36
    +ExclamationEqualsEqualsToken: 36,
    // 37
    +EqualsGreaterThanToken: 37,
    // 38
    +PlusToken: 38,
    // 39
    +MinusToken: 39,
    // 40
    +AsteriskToken: 40,
    // 41
    +AsteriskAsteriskToken: 41,
    // 42
    +SlashToken: 42,
    // 43
    +PercentToken: 43,
    // 44
    +PlusPlusToken: 44,
    // 45
    +MinusMinusToken: 45,
    // 46
    +LessThanLessThanToken: 46,
    // 47
    +GreaterThanGreaterThanToken: 47,
    // 48
    +GreaterThanGreaterThanGreaterThanToken: 48,
    // 49
    +AmpersandToken: 49,
    // 50
    +BarToken: 50,
    // 51
    +CaretToken: 51,
    // 52
    +ExclamationToken: 52,
    // 53
    +TildeToken: 53,
    // 54
    +AmpersandAmpersandToken: 54,
    // 55
    +BarBarToken: 55,
    // 56
    +QuestionToken: 56,
    // 57
    +ColonToken: 57,
    // 58
    +AtToken: 58,
    // 59
    +EqualsToken: 59,
    // 60
    +PlusEqualsToken: 60,
    // 61
    +MinusEqualsToken: 61,
    // 62
    +AsteriskEqualsToken: 62,
    // 63
    +AsteriskAsteriskEqualsToken: 63,
    // 64
    +SlashEqualsToken: 64,
    // 65
    +PercentEqualsToken: 65,
    // 66
    +LessThanLessThanEqualsToken: 66,
    // 67
    +GreaterThanGreaterThanEqualsToken: 67,
    // 68
    +GreaterThanGreaterThanGreaterThanEqualsToken: 68,
    // 69
    +AmpersandEqualsToken: 69,
    // 70
    +BarEqualsToken: 70,
    // 71
    +CaretEqualsToken: 71,
    // 72
    +Identifier: 72,
    // 73
    +BreakKeyword: 73,
    // 74
    +CaseKeyword: 74,
    // 75
    +CatchKeyword: 75,
    // 76
    +ClassKeyword: 76,
    // 77
    +ConstKeyword: 77,
    // 78
    +ContinueKeyword: 78,
    // 79
    +DebuggerKeyword: 79,
    // 80
    +DefaultKeyword: 80,
    // 81
    +DeleteKeyword: 81,
    // 82
    +DoKeyword: 82,
    // 83
    +ElseKeyword: 83,
    // 84
    +EnumKeyword: 84,
    // 85
    +ExportKeyword: 85,
    // 86
    +ExtendsKeyword: 86,
    // 87
    +FalseKeyword: 87,
    // 88
    +FinallyKeyword: 88,
    // 89
    +ForKeyword: 89,
    // 90
    +FunctionKeyword: 90,
    // 91
    +IfKeyword: 91,
    // 92
    +ImportKeyword: 92,
    // 93
    +InKeyword: 93,
    // 94
    +InstanceOfKeyword: 94,
    // 95
    +NewKeyword: 95,
    // 96
    +NullKeyword: 96,
    // 97
    +ReturnKeyword: 97,
    // 98
    +SuperKeyword: 98,
    // 99
    +SwitchKeyword: 99,
    // 100
    +ThisKeyword: 100,
    // 101
    +ThrowKeyword: 101,
    // 102
    +TrueKeyword: 102,
    // 103
    +TryKeyword: 103,
    // 104
    +TypeOfKeyword: 104,
    // 105
    +VarKeyword: 105,
    // 106
    +VoidKeyword: 106,
    // 107
    +WhileKeyword: 107,
    // 108
    +WithKeyword: 108,
    // 109
    +ImplementsKeyword: 109,
    // 110
    +InterfaceKeyword: 110,
    // 111
    +LetKeyword: 111,
    // 112
    +PackageKeyword: 112,
    // 113
    +PrivateKeyword: 113,
    // 114
    +ProtectedKeyword: 114,
    // 115
    +PublicKeyword: 115,
    // 116
    +StaticKeyword: 116,
    // 117
    +YieldKeyword: 117,
    // 118
    +AbstractKeyword: 118,
    // 119
    +AsKeyword: 119,
    // 120
    +AnyKeyword: 120,
    // 121
    +AsyncKeyword: 121,
    // 122
    +AwaitKeyword: 122,
    // 123
    +BooleanKeyword: 123,
    // 124
    +ConstructorKeyword: 124,
    // 125
    +DeclareKeyword: 125,
    // 126
    +GetKeyword: 126,
    // 127
    +InferKeyword: 127,
    // 128
    +IsKeyword: 128,
    // 129
    +KeyOfKeyword: 129,
    // 130
    +ModuleKeyword: 130,
    // 131
    +NamespaceKeyword: 131,
    // 132
    +NeverKeyword: 132,
    // 133
    +ReadonlyKeyword: 133,
    // 134
    +RequireKeyword: 134,
    // 135
    +NumberKeyword: 135,
    // 136
    +ObjectKeyword: 136,
    // 137
    +SetKeyword: 137,
    // 138
    +StringKeyword: 138,
    // 139
    +SymbolKeyword: 139,
    // 140
    +TypeKeyword: 140,
    // 141
    +UndefinedKeyword: 141,
    // 142
    +UniqueKeyword: 142,
    // 143
    +UnknownKeyword: 143,
    // 144
    +FromKeyword: 144,
    // 145
    +GlobalKeyword: 145,
    // 146
    +BigIntKeyword: 146,
    // 147
    +OfKeyword: 147,
    // 148
    +QualifiedName: 148,
    // 149
    +ComputedPropertyName: 149,
    // 150
    +TypeParameter: 150,
    // 151
    +Parameter: 151,
    // 152
    +Decorator: 152,
    // 153
    +PropertySignature: 153,
    // 154
    +PropertyDeclaration: 154,
    // 155
    +MethodSignature: 155,
    // 156
    +MethodDeclaration: 156,
    // 157
    +Constructor: 157,
    // 158
    +GetAccessor: 158,
    // 159
    +SetAccessor: 159,
    // 160
    +CallSignature: 160,
    // 161
    +ConstructSignature: 161,
    // 162
    +IndexSignature: 162,
    // 163
    +TypePredicate: 163,
    // 164
    +TypeReference: 164,
    // 165
    +FunctionType: 165,
    // 166
    +ConstructorType: 166,
    // 167
    +TypeQuery: 167,
    // 168
    +TypeLiteral: 168,
    // 169
    +ArrayType: 169,
    // 170
    +TupleType: 170,
    // 171
    +OptionalType: 171,
    // 172
    +RestType: 172,
    // 173
    +UnionType: 173,
    // 174
    +IntersectionType: 174,
    // 175
    +ConditionalType: 175,
    // 176
    +InferType: 176,
    // 177
    +ParenthesizedType: 177,
    // 178
    +ThisType: 178,
    // 179
    +TypeOperator: 179,
    // 180
    +IndexedAccessType: 180,
    // 181
    +MappedType: 181,
    // 182
    +LiteralType: 182,
    // 183
    +ImportType: 183,
    // 184
    +ObjectBindingPattern: 184,
    // 185
    +ArrayBindingPattern: 185,
    // 186
    +BindingElement: 186,
    // 187
    +ArrayLiteralExpression: 187,
    // 188
    +ObjectLiteralExpression: 188,
    // 189
    +PropertyAccessExpression: 189,
    // 190
    +ElementAccessExpression: 190,
    // 191
    +CallExpression: 191,
    // 192
    +NewExpression: 192,
    // 193
    +TaggedTemplateExpression: 193,
    // 194
    +TypeAssertionExpression: 194,
    // 195
    +ParenthesizedExpression: 195,
    // 196
    +FunctionExpression: 196,
    // 197
    +ArrowFunction: 197,
    // 198
    +DeleteExpression: 198,
    // 199
    +TypeOfExpression: 199,
    // 200
    +VoidExpression: 200,
    // 201
    +AwaitExpression: 201,
    // 202
    +PrefixUnaryExpression: 202,
    // 203
    +PostfixUnaryExpression: 203,
    // 204
    +BinaryExpression: 204,
    // 205
    +ConditionalExpression: 205,
    // 206
    +TemplateExpression: 206,
    // 207
    +YieldExpression: 207,
    // 208
    +SpreadElement: 208,
    // 209
    +ClassExpression: 209,
    // 210
    +OmittedExpression: 210,
    // 211
    +ExpressionWithTypeArguments: 211,
    // 212
    +AsExpression: 212,
    // 213
    +NonNullExpression: 213,
    // 214
    +MetaProperty: 214,
    // 215
    +SyntheticExpression: 215,
    // 216
    +TemplateSpan: 216,
    // 217
    +SemicolonClassElement: 217,
    // 218
    +Block: 218,
    // 219
    +VariableStatement: 219,
    // 220
    +EmptyStatement: 220,
    // 221
    +ExpressionStatement: 221,
    // 222
    +IfStatement: 222,
    // 223
    +DoStatement: 223,
    // 224
    +WhileStatement: 224,
    // 225
    +ForStatement: 225,
    // 226
    +ForInStatement: 226,
    // 227
    +ForOfStatement: 227,
    // 228
    +ContinueStatement: 228,
    // 229
    +BreakStatement: 229,
    // 230
    +ReturnStatement: 230,
    // 231
    +WithStatement: 231,
    // 232
    +SwitchStatement: 232,
    // 233
    +LabeledStatement: 233,
    // 234
    +ThrowStatement: 234,
    // 235
    +TryStatement: 235,
    // 236
    +DebuggerStatement: 236,
    // 237
    +VariableDeclaration: 237,
    // 238
    +VariableDeclarationList: 238,
    // 239
    +FunctionDeclaration: 239,
    // 240
    +ClassDeclaration: 240,
    // 241
    +InterfaceDeclaration: 241,
    // 242
    +TypeAliasDeclaration: 242,
    // 243
    +EnumDeclaration: 243,
    // 244
    +ModuleDeclaration: 244,
    // 245
    +ModuleBlock: 245,
    // 246
    +CaseBlock: 246,
    // 247
    +NamespaceExportDeclaration: 247,
    // 248
    +ImportEqualsDeclaration: 248,
    // 249
    +ImportDeclaration: 249,
    // 250
    +ImportClause: 250,
    // 251
    +NamespaceImport: 251,
    // 252
    +NamedImports: 252,
    // 253
    +ImportSpecifier: 253,
    // 254
    +ExportAssignment: 254,
    // 255
    +ExportDeclaration: 255,
    // 256
    +NamedExports: 256,
    // 257
    +ExportSpecifier: 257,
    // 258
    +MissingDeclaration: 258,
    // 259
    +ExternalModuleReference: 259,
    // 260
    +JsxElement: 260,
    // 261
    +JsxSelfClosingElement: 261,
    // 262
    +JsxOpeningElement: 262,
    // 263
    +JsxClosingElement: 263,
    // 264
    +JsxFragment: 264,
    // 265
    +JsxOpeningFragment: 265,
    // 266
    +JsxClosingFragment: 266,
    // 267
    +JsxAttribute: 267,
    // 268
    +JsxAttributes: 268,
    // 269
    +JsxSpreadAttribute: 269,
    // 270
    +JsxExpression: 270,
    // 271
    +CaseClause: 271,
    // 272
    +DefaultClause: 272,
    // 273
    +HeritageClause: 273,
    // 274
    +CatchClause: 274,
    // 275
    +PropertyAssignment: 275,
    // 276
    +ShorthandPropertyAssignment: 276,
    // 277
    +SpreadAssignment: 277,
    // 278
    +EnumMember: 278,
    // 279
    +SourceFile: 279,
    // 280
    +Bundle: 280,
    // 281
    +UnparsedSource: 281,
    // 282
    +InputFiles: 282,
    // 283
    +JSDocTypeExpression: 283,
    // 284
    +JSDocAllType: 284,
    // 285
    +JSDocUnknownType: 285,
    // 286
    +JSDocNullableType: 286,
    // 287
    +JSDocNonNullableType: 287,
    // 288
    +JSDocOptionalType: 288,
    // 289
    +JSDocFunctionType: 289,
    // 290
    +JSDocVariadicType: 290,
    // 291
    +JSDocComment: 291,
    // 292
    +JSDocTypeLiteral: 292,
    // 293
    +JSDocSignature: 293,
    // 294
    +JSDocTag: 294,
    // 295
    +JSDocAugmentsTag: 295,
    // 296
    +JSDocClassTag: 296,
    // 297
    +JSDocCallbackTag: 297,
    // 298
    +JSDocEnumTag: 298,
    // 299
    +JSDocParameterTag: 299,
    // 300
    +JSDocReturnTag: 300,
    // 301
    +JSDocThisTag: 301,
    // 302
    +JSDocTypeTag: 302,
    // 303
    +JSDocTemplateTag: 303,
    // 304
    +JSDocTypedefTag: 304,
    // 305
    +JSDocPropertyTag: 305,
    // 306
    +SyntaxList: 306,
    // 307
    +NotEmittedStatement: 307,
    // 308
    +PartiallyEmittedExpression: 308,
    // 309
    +CommaListExpression: 309,
    // 310
    +MergeDeclarationMarker: 310,
    // 311
    +EndOfDeclarationMarker: 311,
    // 312
    +Count: 312,
    // 59
    +FirstAssignment: 59,
    // 71
    +LastAssignment: 71,
    // 60
    +FirstCompoundAssignment: 60,
    // 71
    +LastCompoundAssignment: 71,
    // 73
    +FirstReservedWord: 73,
    // 108
    +LastReservedWord: 108,
    // 73
    +FirstKeyword: 73,
    // 147
    +LastKeyword: 147,
    // 109
    +FirstFutureReservedWord: 109,
    // 117
    +LastFutureReservedWord: 117,
    // 163
    +FirstTypeNode: 163,
    // 183
    +LastTypeNode: 183,
    // 18
    +FirstPunctuation: 18,
    // 71
    +LastPunctuation: 71,
    // 0
    +FirstToken: 0,
    // 147
    +LastToken: 147,
    // 2
    +FirstTriviaToken: 2,
    // 7
    +LastTriviaToken: 7,
    // 8
    +FirstLiteralToken: 8,
    // 14
    +LastLiteralToken: 14,
    // 14
    +FirstTemplateToken: 14,
    // 17
    +LastTemplateToken: 17,
    // 28
    +FirstBinaryOperator: 28,
    // 71
    +LastBinaryOperator: 71,
    // 148
    +FirstNode: 148,
    // 283
    +FirstJSDocNode: 283,
    // 305
    +LastJSDocNode: 305,
    // 294
    +FirstJSDocTagNode: 294,
    // 305
    +LastJSDocTagNode: 305,
    ...
  };

  declare var NodeFlags: {
    // 0
    +None: 0,
    // 1
    +Let: 1,
    // 2
    +Const: 2,
    // 4
    +NestedNamespace: 4,
    // 8
    +Synthesized: 8,
    // 16
    +Namespace: 16,
    // 32
    +ExportContext: 32,
    // 64
    +ContainsThis: 64,
    // 128
    +HasImplicitReturn: 128,
    // 256
    +HasExplicitReturn: 256,
    // 512
    +GlobalAugmentation: 512,
    // 1024
    +HasAsyncFunctions: 1024,
    // 2048
    +DisallowInContext: 2048,
    // 4096
    +YieldContext: 4096,
    // 8192
    +DecoratorContext: 8192,
    // 16384
    +AwaitContext: 16384,
    // 32768
    +ThisNodeHasError: 32768,
    // 65536
    +JavaScriptFile: 65536,
    // 131072
    +ThisNodeOrAnySubNodesHasError: 131072,
    // 262144
    +HasAggregatedChildData: 262144,
    // 2097152
    +JSDoc: 2097152,
    // 16777216
    +JsonFile: 16777216,
    // 3
    +BlockScoped: 3,
    // 384
    +ReachabilityCheckFlags: 384,
    // 1408
    +ReachabilityAndEmitFlags: 1408,
    // 12679168
    +ContextFlags: 12679168,
    // 20480
    +TypeExcludesFlags: 20480,
    ...
  };

  declare var ModifierFlags: {
    // 0
    +None: 0,
    // 1
    +Export: 1,
    // 2
    +Ambient: 2,
    // 4
    +Public: 4,
    // 8
    +Private: 8,
    // 16
    +Protected: 16,
    // 32
    +Static: 32,
    // 64
    +Readonly: 64,
    // 128
    +Abstract: 128,
    // 256
    +Async: 256,
    // 512
    +Default: 512,
    // 2048
    +Const: 2048,
    // 536870912
    +HasComputedFlags: 536870912,
    // 28
    +AccessibilityModifier: 28,
    // 92
    +ParameterPropertyModifier: 92,
    // 24
    +NonPublicAccessibilityModifier: 24,
    // 2270
    +TypeScriptModifier: 2270,
    // 513
    +ExportDefault: 513,
    // 3071
    +All: 3071,
    ...
  };

  declare var JsxFlags: {
    // 0
    +None: 0,
    // 1
    +IntrinsicNamedElement: 1,
    // 2
    +IntrinsicIndexedElement: 2,
    // 3
    +IntrinsicElement: 3,
    ...
  };

  declare type Node = {
    ...$Exact<TextRange>,
    kind: $Values<typeof SyntaxKind>,
    flags: $Values<typeof NodeFlags>,
    decorators?: NodeArray<Decorator>,
    modifiers?: ModifiersArray,
    parent: any,
    getSourceFile(): SourceFile,
    getChildCount(sourceFile?: SourceFile): number,
    getChildAt(index: number, sourceFile?: SourceFile): Node,
    getChildren(sourceFile?: SourceFile): Node[],
    getStart(sourceFile?: SourceFile, includeJsDocComment?: boolean): number,
    getFullStart(): number,
    getEnd(): number,
    getWidth(sourceFile?: SourceFileLike): number,
    getFullWidth(): number,
    getLeadingTriviaWidth(sourceFile?: SourceFile): number,
    getFullText(sourceFile?: SourceFile): string,
    getText(sourceFile?: SourceFile): string,
    getFirstToken(sourceFile?: SourceFile): Node | void,
    getLastToken(sourceFile?: SourceFile): Node | void,
    forEachChild<T>(
      cbNode: (node: Node) => T | void,
      cbNodeArray?: (nodes: NodeArray<Node>) => T | void
    ): T | void,
    ...
  };

  declare type JSDocContainer = {...};

  declare type HasJSDoc =
    | ParameterDeclaration
    | CallSignatureDeclaration
    | ConstructSignatureDeclaration
    | MethodSignature
    | PropertySignature
    | ArrowFunction
    | ParenthesizedExpression
    | SpreadAssignment
    | ShorthandPropertyAssignment
    | PropertyAssignment
    | FunctionExpression
    | LabeledStatement
    | ExpressionStatement
    | VariableStatement
    | FunctionDeclaration
    | ConstructorDeclaration
    | MethodDeclaration
    | PropertyDeclaration
    | AccessorDeclaration
    | ClassLikeDeclaration
    | InterfaceDeclaration
    | TypeAliasDeclaration
    | EnumMember
    | EnumDeclaration
    | ModuleDeclaration
    | ImportEqualsDeclaration
    | IndexSignatureDeclaration
    | FunctionTypeNode
    | ConstructorTypeNode
    | JSDocFunctionType
    | ExportDeclaration
    | EndOfFileToken;
  declare type HasType =
    | SignatureDeclaration
    | VariableDeclaration
    | ParameterDeclaration
    | PropertySignature
    | PropertyDeclaration
    | TypePredicateNode
    | ParenthesizedTypeNode
    | TypeOperatorNode
    | MappedTypeNode
    | AssertionExpression
    | TypeAliasDeclaration
    | JSDocTypeExpression
    | JSDocNonNullableType
    | JSDocNullableType
    | JSDocOptionalType
    | JSDocVariadicType;
  declare type HasInitializer =
    | HasExpressionInitializer
    | ForStatement
    | ForInStatement
    | ForOfStatement
    | JsxAttribute;
  declare type HasExpressionInitializer =
    | VariableDeclaration
    | ParameterDeclaration
    | BindingElement
    | PropertySignature
    | PropertyDeclaration
    | PropertyAssignment
    | EnumMember;
  declare type NodeArray<T: $ReadOnly<Node>> = {
    ...$Exact<TextRange>,
    hasTrailingComma?: boolean,
    ...
  } & $ReadOnlyArray<T>;

  declare type Token<TKind: $Values<typeof SyntaxKind>> = {
    ...$Exact<Node>,
    kind: TKind,
    ...
  };

  declare type DotDotDotToken = Token<typeof SyntaxKind.DotDotDotToken>;
  declare type QuestionToken = Token<typeof SyntaxKind.QuestionToken>;
  declare type ExclamationToken = Token<typeof SyntaxKind.ExclamationToken>;
  declare type ColonToken = Token<typeof SyntaxKind.ColonToken>;
  declare type EqualsToken = Token<typeof SyntaxKind.EqualsToken>;
  declare type AsteriskToken = Token<typeof SyntaxKind.AsteriskToken>;
  declare type EqualsGreaterThanToken = Token<
    typeof SyntaxKind.EqualsGreaterThanToken
  >;
  declare type EndOfFileToken = Token<typeof SyntaxKind.EndOfFileToken> &
    JSDocContainer;
  declare type ReadonlyToken = Token<typeof SyntaxKind.ReadonlyKeyword>;
  declare type AwaitKeywordToken = Token<typeof SyntaxKind.AwaitKeyword>;
  declare type PlusToken = Token<typeof SyntaxKind.PlusToken>;
  declare type MinusToken = Token<typeof SyntaxKind.MinusToken>;
  declare type Modifier =
    | Token<typeof SyntaxKind.AbstractKeyword>
    | Token<typeof SyntaxKind.AsyncKeyword>
    | Token<typeof SyntaxKind.ConstKeyword>
    | Token<typeof SyntaxKind.DeclareKeyword>
    | Token<typeof SyntaxKind.DefaultKeyword>
    | Token<typeof SyntaxKind.ExportKeyword>
    | Token<typeof SyntaxKind.PublicKeyword>
    | Token<typeof SyntaxKind.PrivateKeyword>
    | Token<typeof SyntaxKind.ProtectedKeyword>
    | Token<typeof SyntaxKind.ReadonlyKeyword>
    | Token<typeof SyntaxKind.StaticKeyword>;
  declare type ModifiersArray = NodeArray<Modifier>;
  declare type Identifier = {
    ...$Exact<PrimaryExpression>,
    ...$Exact<Declaration>,
    kind: typeof SyntaxKind.Identifier,
    escapedText: __String,
    originalKeywordKind?: $Values<typeof SyntaxKind>,
    isInJSDocNamespace?: boolean,
    +text: string,
    ...
  };

  declare type TransientIdentifier = {
    ...$Exact<Identifier>,
    resolvedSymbol: Symbol,
    ...
  };

  declare type QualifiedName = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.QualifiedName,
    left: EntityName,
    right: Identifier,
    ...
  };

  declare type EntityName = Identifier | QualifiedName;
  declare type PropertyName =
    | Identifier
    | StringLiteral
    | NumericLiteral
    | ComputedPropertyName;
  declare type DeclarationName =
    | Identifier
    | StringLiteralLike
    | NumericLiteral
    | ComputedPropertyName
    | BindingPattern;
  declare type Declaration = {
    ...$Exact<Node>,
    _declarationBrand: any,
    ...
  };

  declare type NamedDeclaration = {
    ...$Exact<Declaration>,
    name?: DeclarationName,
    ...
  };

  declare type DeclarationStatement = {
    ...$Exact<NamedDeclaration>,
    ...$Exact<Statement>,
    name?: Identifier | StringLiteral | NumericLiteral,
    ...
  };

  declare type ComputedPropertyName = {
    ...$Exact<Node>,
    parent: Declaration,
    kind: typeof SyntaxKind.ComputedPropertyName,
    expression: Expression,
    ...
  };

  declare type Decorator = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.Decorator,
    parent: NamedDeclaration,
    expression: LeftHandSideExpression,
    ...
  };

  declare type TypeParameterDeclaration = {
    ...$Exact<NamedDeclaration>,
    kind: typeof SyntaxKind.TypeParameter,
    parent: DeclarationWithTypeParameterChildren | InferTypeNode,
    name: Identifier,
    constraint?: TypeNode,
    default?: TypeNode,
    expression?: Expression,
    ...
  };

  declare type SignatureDeclarationBase = {
    ...$Exact<NamedDeclaration>,
    ...$Exact<JSDocContainer>,
    kind: $ElementType<SignatureDeclaration, "kind">,
    name?: PropertyName,
    typeParameters?: NodeArray<TypeParameterDeclaration>,
    parameters: NodeArray<ParameterDeclaration>,
    type?: TypeNode,
    ...
  };

  declare type SignatureDeclaration =
    | CallSignatureDeclaration
    | ConstructSignatureDeclaration
    | MethodSignature
    | IndexSignatureDeclaration
    | FunctionTypeNode
    | ConstructorTypeNode
    | JSDocFunctionType
    | FunctionDeclaration
    | MethodDeclaration
    | ConstructorDeclaration
    | AccessorDeclaration
    | FunctionExpression
    | ArrowFunction;
  declare type CallSignatureDeclaration = {
    ...$Exact<SignatureDeclarationBase>,
    ...$Exact<TypeElement>,
    kind: typeof SyntaxKind.CallSignature,
    ...
  };

  declare type ConstructSignatureDeclaration = {
    ...$Exact<SignatureDeclarationBase>,
    ...$Exact<TypeElement>,
    kind: typeof SyntaxKind.ConstructSignature,
    ...
  };

  declare type BindingName = Identifier | BindingPattern;
  declare type VariableDeclaration = {
    ...$Exact<NamedDeclaration>,
    kind: typeof SyntaxKind.VariableDeclaration,
    parent: VariableDeclarationList | CatchClause,
    name: BindingName,
    exclamationToken?: ExclamationToken,
    type?: TypeNode,
    initializer?: Expression,
    ...
  };

  declare type VariableDeclarationList = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.VariableDeclarationList,
    parent: VariableStatement | ForStatement | ForOfStatement | ForInStatement,
    declarations: NodeArray<VariableDeclaration>,
    ...
  };

  declare type ParameterDeclaration = {
    ...$Exact<NamedDeclaration>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.Parameter,
    parent: SignatureDeclaration,
    dotDotDotToken?: DotDotDotToken,
    name: BindingName,
    questionToken?: QuestionToken,
    type?: TypeNode,
    initializer?: Expression,
    ...
  };

  declare type BindingElement = {
    ...$Exact<NamedDeclaration>,
    kind: typeof SyntaxKind.BindingElement,
    parent: BindingPattern,
    propertyName?: PropertyName,
    dotDotDotToken?: DotDotDotToken,
    name: BindingName,
    initializer?: Expression,
    ...
  };

  declare type PropertySignature = {
    ...$Exact<TypeElement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.PropertySignature,
    name: PropertyName,
    questionToken?: QuestionToken,
    type?: TypeNode,
    initializer?: Expression,
    ...
  };

  declare type PropertyDeclaration = {
    ...$Exact<ClassElement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.PropertyDeclaration,
    parent: ClassLikeDeclaration,
    name: PropertyName,
    questionToken?: QuestionToken,
    exclamationToken?: ExclamationToken,
    type?: TypeNode,
    initializer?: Expression,
    ...
  };

  declare type ObjectLiteralElement = {
    ...$Exact<NamedDeclaration>,
    _objectLiteralBrandBrand: any,
    name?: PropertyName,
    ...
  };

  declare type ObjectLiteralElementLike =
    | PropertyAssignment
    | ShorthandPropertyAssignment
    | SpreadAssignment
    | MethodDeclaration
    | AccessorDeclaration;
  declare type PropertyAssignment = {
    ...$Exact<ObjectLiteralElement>,
    ...$Exact<JSDocContainer>,
    parent: ObjectLiteralExpression,
    kind: typeof SyntaxKind.PropertyAssignment,
    name: PropertyName,
    questionToken?: QuestionToken,
    initializer: Expression,
    ...
  };

  declare type ShorthandPropertyAssignment = {
    ...$Exact<ObjectLiteralElement>,
    ...$Exact<JSDocContainer>,
    parent: ObjectLiteralExpression,
    kind: typeof SyntaxKind.ShorthandPropertyAssignment,
    name: Identifier,
    questionToken?: QuestionToken,
    exclamationToken?: ExclamationToken,
    equalsToken?: Token<typeof SyntaxKind.EqualsToken>,
    objectAssignmentInitializer?: Expression,
    ...
  };

  declare type SpreadAssignment = {
    ...$Exact<ObjectLiteralElement>,
    ...$Exact<JSDocContainer>,
    parent: ObjectLiteralExpression,
    kind: typeof SyntaxKind.SpreadAssignment,
    expression: Expression,
    ...
  };

  declare type VariableLikeDeclaration =
    | VariableDeclaration
    | ParameterDeclaration
    | BindingElement
    | PropertyDeclaration
    | PropertyAssignment
    | PropertySignature
    | JsxAttribute
    | ShorthandPropertyAssignment
    | EnumMember
    | JSDocPropertyTag
    | JSDocParameterTag;
  declare type PropertyLikeDeclaration = {
    ...$Exact<NamedDeclaration>,
    name: PropertyName,
    ...
  };

  declare type ObjectBindingPattern = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.ObjectBindingPattern,
    parent: VariableDeclaration | ParameterDeclaration | BindingElement,
    elements: NodeArray<BindingElement>,
    ...
  };

  declare type ArrayBindingPattern = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.ArrayBindingPattern,
    parent: VariableDeclaration | ParameterDeclaration | BindingElement,
    elements: NodeArray<ArrayBindingElement>,
    ...
  };

  declare type BindingPattern = ObjectBindingPattern | ArrayBindingPattern;
  declare type ArrayBindingElement = BindingElement | OmittedExpression;
  declare type FunctionLikeDeclarationBase = {
    ...$Exact<SignatureDeclarationBase>,
    _functionLikeDeclarationBrand: any,
    asteriskToken?: AsteriskToken,
    questionToken?: QuestionToken,
    exclamationToken?: ExclamationToken,
    body?: Block | Expression,
    ...
  };

  declare type FunctionLikeDeclaration =
    | FunctionDeclaration
    | MethodDeclaration
    | GetAccessorDeclaration
    | SetAccessorDeclaration
    | ConstructorDeclaration
    | FunctionExpression
    | ArrowFunction;
  declare type FunctionLike = SignatureDeclaration;
  declare type FunctionDeclaration = {
    ...$Exact<FunctionLikeDeclarationBase>,
    ...$Exact<DeclarationStatement>,
    kind: typeof SyntaxKind.FunctionDeclaration,
    name?: Identifier,
    body?: FunctionBody,
    ...
  };

  declare type MethodSignature = {
    ...$Exact<SignatureDeclarationBase>,
    ...$Exact<TypeElement>,
    kind: typeof SyntaxKind.MethodSignature,
    parent: ObjectTypeDeclaration,
    name: PropertyName,
    ...
  };

  declare type MethodDeclaration = {
    ...$Exact<FunctionLikeDeclarationBase>,
    ...$Exact<ClassElement>,
    ...$Exact<ObjectLiteralElement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.MethodDeclaration,
    parent: ClassLikeDeclaration | ObjectLiteralExpression,
    name: PropertyName,
    body?: FunctionBody,
    ...
  };

  declare type ConstructorDeclaration = {
    ...$Exact<FunctionLikeDeclarationBase>,
    ...$Exact<ClassElement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.Constructor,
    parent: ClassLikeDeclaration,
    body?: FunctionBody,
    ...
  };

  declare type SemicolonClassElement = {
    ...$Exact<ClassElement>,
    kind: typeof SyntaxKind.SemicolonClassElement,
    parent: ClassLikeDeclaration,
    ...
  };

  declare type GetAccessorDeclaration = {
    ...$Exact<FunctionLikeDeclarationBase>,
    ...$Exact<ClassElement>,
    ...$Exact<ObjectLiteralElement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.GetAccessor,
    parent: ClassLikeDeclaration | ObjectLiteralExpression,
    name: PropertyName,
    body?: FunctionBody,
    ...
  };

  declare type SetAccessorDeclaration = {
    ...$Exact<FunctionLikeDeclarationBase>,
    ...$Exact<ClassElement>,
    ...$Exact<ObjectLiteralElement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.SetAccessor,
    parent: ClassLikeDeclaration | ObjectLiteralExpression,
    name: PropertyName,
    body?: FunctionBody,
    ...
  };

  declare type AccessorDeclaration =
    | GetAccessorDeclaration
    | SetAccessorDeclaration;
  declare type IndexSignatureDeclaration = {
    ...$Exact<SignatureDeclarationBase>,
    ...$Exact<ClassElement>,
    ...$Exact<TypeElement>,
    kind: typeof SyntaxKind.IndexSignature,
    parent: ObjectTypeDeclaration,
    ...
  };

  declare type TypeNode = {
    ...$Exact<Node>,
    _typeNodeBrand: any,
    ...
  };

  declare type KeywordTypeNode = {
    ...$Exact<TypeNode>,
    kind:
      | typeof SyntaxKind.AnyKeyword
      | typeof SyntaxKind.UnknownKeyword
      | typeof SyntaxKind.NumberKeyword
      | typeof SyntaxKind.BigIntKeyword
      | typeof SyntaxKind.ObjectKeyword
      | typeof SyntaxKind.BooleanKeyword
      | typeof SyntaxKind.StringKeyword
      | typeof SyntaxKind.SymbolKeyword
      | typeof SyntaxKind.ThisKeyword
      | typeof SyntaxKind.VoidKeyword
      | typeof SyntaxKind.UndefinedKeyword
      | typeof SyntaxKind.NullKeyword
      | typeof SyntaxKind.NeverKeyword,
    ...
  };

  declare type ImportTypeNode = {
    ...$Exact<NodeWithTypeArguments>,
    kind: typeof SyntaxKind.ImportType,
    isTypeOf?: boolean,
    argument: TypeNode,
    qualifier?: EntityName,
    ...
  };

  declare type ThisTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.ThisType,
    ...
  };

  declare type FunctionOrConstructorTypeNode =
    | FunctionTypeNode
    | ConstructorTypeNode;
  declare type FunctionOrConstructorTypeNodeBase = {
    ...$Exact<TypeNode>,
    ...$Exact<SignatureDeclarationBase>,
    kind: typeof SyntaxKind.FunctionType | typeof SyntaxKind.ConstructorType,
    type: TypeNode,
    ...
  };

  declare type FunctionTypeNode = {
    ...$Exact<FunctionOrConstructorTypeNodeBase>,
    kind: typeof SyntaxKind.FunctionType,
    ...
  };

  declare type ConstructorTypeNode = {
    ...$Exact<FunctionOrConstructorTypeNodeBase>,
    kind: typeof SyntaxKind.ConstructorType,
    ...
  };

  declare type NodeWithTypeArguments = {
    ...$Exact<TypeNode>,
    typeArguments?: NodeArray<TypeNode>,
    ...
  };

  declare type TypeReferenceType =
    | TypeReferenceNode
    | ExpressionWithTypeArguments;
  declare type TypeReferenceNode = {
    ...$Exact<NodeWithTypeArguments>,
    kind: typeof SyntaxKind.TypeReference,
    typeName: EntityName,
    ...
  };

  declare type TypePredicateNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.TypePredicate,
    parent: SignatureDeclaration | JSDocTypeExpression,
    parameterName: Identifier | ThisTypeNode,
    type: TypeNode,
    ...
  };

  declare type TypeQueryNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.TypeQuery,
    exprName: EntityName,
    ...
  };

  declare type TypeLiteralNode = {
    ...$Exact<TypeNode>,
    ...$Exact<Declaration>,
    kind: typeof SyntaxKind.TypeLiteral,
    members: NodeArray<TypeElement>,
    ...
  };

  declare type ArrayTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.ArrayType,
    elementType: TypeNode,
    ...
  };

  declare type TupleTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.TupleType,
    elementTypes: NodeArray<TypeNode>,
    ...
  };

  declare type OptionalTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.OptionalType,
    type: TypeNode,
    ...
  };

  declare type RestTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.RestType,
    type: TypeNode,
    ...
  };

  declare type UnionOrIntersectionTypeNode =
    | UnionTypeNode
    | IntersectionTypeNode;
  declare type UnionTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.UnionType,
    types: NodeArray<TypeNode>,
    ...
  };

  declare type IntersectionTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.IntersectionType,
    types: NodeArray<TypeNode>,
    ...
  };

  declare type ConditionalTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.ConditionalType,
    checkType: TypeNode,
    extendsType: TypeNode,
    trueType: TypeNode,
    falseType: TypeNode,
    ...
  };

  declare type InferTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.InferType,
    typeParameter: TypeParameterDeclaration,
    ...
  };

  declare type ParenthesizedTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.ParenthesizedType,
    type: TypeNode,
    ...
  };

  declare type TypeOperatorNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.TypeOperator,
    operator: typeof SyntaxKind.KeyOfKeyword | typeof SyntaxKind.UniqueKeyword,
    type: TypeNode,
    ...
  };

  declare type IndexedAccessTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.IndexedAccessType,
    objectType: TypeNode,
    indexType: TypeNode,
    ...
  };

  declare type MappedTypeNode = {
    ...$Exact<TypeNode>,
    ...$Exact<Declaration>,
    kind: typeof SyntaxKind.MappedType,
    readonlyToken?: ReadonlyToken | PlusToken | MinusToken,
    typeParameter: TypeParameterDeclaration,
    questionToken?: QuestionToken | PlusToken | MinusToken,
    type?: TypeNode,
    ...
  };

  declare type LiteralTypeNode = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.LiteralType,
    literal: BooleanLiteral | LiteralExpression | PrefixUnaryExpression,
    ...
  };

  declare type StringLiteral = {
    ...$Exact<LiteralExpression>,
    kind: typeof SyntaxKind.StringLiteral,
    ...
  };

  declare type StringLiteralLike =
    | StringLiteral
    | NoSubstitutionTemplateLiteral;
  declare type Expression = {
    ...$Exact<Node>,
    _expressionBrand: any,
    ...
  };

  declare type OmittedExpression = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.OmittedExpression,
    ...
  };

  declare type PartiallyEmittedExpression = {
    ...$Exact<LeftHandSideExpression>,
    kind: typeof SyntaxKind.PartiallyEmittedExpression,
    expression: Expression,
    ...
  };

  declare type UnaryExpression = {
    ...$Exact<Expression>,
    _unaryExpressionBrand: any,
    ...
  };

  declare type IncrementExpression = UpdateExpression;
  declare type UpdateExpression = {
    ...$Exact<UnaryExpression>,
    _updateExpressionBrand: any,
    ...
  };

  declare type PrefixUnaryOperator =
    | typeof SyntaxKind.PlusPlusToken
    | typeof SyntaxKind.MinusMinusToken
    | typeof SyntaxKind.PlusToken
    | typeof SyntaxKind.MinusToken
    | typeof SyntaxKind.TildeToken
    | typeof SyntaxKind.ExclamationToken;
  declare type PrefixUnaryExpression = {
    ...$Exact<UpdateExpression>,
    kind: typeof SyntaxKind.PrefixUnaryExpression,
    operator: PrefixUnaryOperator,
    operand: UnaryExpression,
    ...
  };

  declare type PostfixUnaryOperator =
    | typeof SyntaxKind.PlusPlusToken
    | typeof SyntaxKind.MinusMinusToken;
  declare type PostfixUnaryExpression = {
    ...$Exact<UpdateExpression>,
    kind: typeof SyntaxKind.PostfixUnaryExpression,
    operand: LeftHandSideExpression,
    operator: PostfixUnaryOperator,
    ...
  };

  declare type LeftHandSideExpression = {
    ...$Exact<UpdateExpression>,
    _leftHandSideExpressionBrand: any,
    ...
  };

  declare type MemberExpression = {
    ...$Exact<LeftHandSideExpression>,
    _memberExpressionBrand: any,
    ...
  };

  declare type PrimaryExpression = {
    ...$Exact<MemberExpression>,
    _primaryExpressionBrand: any,
    ...
  };

  declare type NullLiteral = {
    ...$Exact<PrimaryExpression>,
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.NullKeyword,
    ...
  };

  declare type BooleanLiteral = {
    ...$Exact<PrimaryExpression>,
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.TrueKeyword | typeof SyntaxKind.FalseKeyword,
    ...
  };

  declare type ThisExpression = {
    ...$Exact<PrimaryExpression>,
    ...$Exact<KeywordTypeNode>,
    kind: typeof SyntaxKind.ThisKeyword,
    ...
  };

  declare type SuperExpression = {
    ...$Exact<PrimaryExpression>,
    kind: typeof SyntaxKind.SuperKeyword,
    ...
  };

  declare type ImportExpression = {
    ...$Exact<PrimaryExpression>,
    kind: typeof SyntaxKind.ImportKeyword,
    ...
  };

  declare type DeleteExpression = {
    ...$Exact<UnaryExpression>,
    kind: typeof SyntaxKind.DeleteExpression,
    expression: UnaryExpression,
    ...
  };

  declare type TypeOfExpression = {
    ...$Exact<UnaryExpression>,
    kind: typeof SyntaxKind.TypeOfExpression,
    expression: UnaryExpression,
    ...
  };

  declare type VoidExpression = {
    ...$Exact<UnaryExpression>,
    kind: typeof SyntaxKind.VoidExpression,
    expression: UnaryExpression,
    ...
  };

  declare type AwaitExpression = {
    ...$Exact<UnaryExpression>,
    kind: typeof SyntaxKind.AwaitExpression,
    expression: UnaryExpression,
    ...
  };

  declare type YieldExpression = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.YieldExpression,
    asteriskToken?: AsteriskToken,
    expression?: Expression,
    ...
  };

  declare type SyntheticExpression = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.SyntheticExpression,
    isSpread: boolean,
    type: Type,
    ...
  };

  declare type ExponentiationOperator = typeof SyntaxKind.AsteriskAsteriskToken;
  declare type MultiplicativeOperator =
    | typeof SyntaxKind.AsteriskToken
    | typeof SyntaxKind.SlashToken
    | typeof SyntaxKind.PercentToken;
  declare type MultiplicativeOperatorOrHigher =
    | ExponentiationOperator
    | MultiplicativeOperator;
  declare type AdditiveOperator =
    | typeof SyntaxKind.PlusToken
    | typeof SyntaxKind.MinusToken;
  declare type AdditiveOperatorOrHigher =
    | MultiplicativeOperatorOrHigher
    | AdditiveOperator;
  declare type ShiftOperator =
    | typeof SyntaxKind.LessThanLessThanToken
    | typeof SyntaxKind.GreaterThanGreaterThanToken
    | typeof SyntaxKind.GreaterThanGreaterThanGreaterThanToken;
  declare type ShiftOperatorOrHigher = AdditiveOperatorOrHigher | ShiftOperator;
  declare type RelationalOperator =
    | typeof SyntaxKind.LessThanToken
    | typeof SyntaxKind.LessThanEqualsToken
    | typeof SyntaxKind.GreaterThanToken
    | typeof SyntaxKind.GreaterThanEqualsToken
    | typeof SyntaxKind.InstanceOfKeyword
    | typeof SyntaxKind.InKeyword;
  declare type RelationalOperatorOrHigher =
    | ShiftOperatorOrHigher
    | RelationalOperator;
  declare type EqualityOperator =
    | typeof SyntaxKind.EqualsEqualsToken
    | typeof SyntaxKind.EqualsEqualsEqualsToken
    | typeof SyntaxKind.ExclamationEqualsEqualsToken
    | typeof SyntaxKind.ExclamationEqualsToken;
  declare type EqualityOperatorOrHigher =
    | RelationalOperatorOrHigher
    | EqualityOperator;
  declare type BitwiseOperator =
    | typeof SyntaxKind.AmpersandToken
    | typeof SyntaxKind.BarToken
    | typeof SyntaxKind.CaretToken;
  declare type BitwiseOperatorOrHigher =
    | EqualityOperatorOrHigher
    | BitwiseOperator;
  declare type LogicalOperator =
    | typeof SyntaxKind.AmpersandAmpersandToken
    | typeof SyntaxKind.BarBarToken;
  declare type LogicalOperatorOrHigher =
    | BitwiseOperatorOrHigher
    | LogicalOperator;
  declare type CompoundAssignmentOperator =
    | typeof SyntaxKind.PlusEqualsToken
    | typeof SyntaxKind.MinusEqualsToken
    | typeof SyntaxKind.AsteriskAsteriskEqualsToken
    | typeof SyntaxKind.AsteriskEqualsToken
    | typeof SyntaxKind.SlashEqualsToken
    | typeof SyntaxKind.PercentEqualsToken
    | typeof SyntaxKind.AmpersandEqualsToken
    | typeof SyntaxKind.BarEqualsToken
    | typeof SyntaxKind.CaretEqualsToken
    | typeof SyntaxKind.LessThanLessThanEqualsToken
    | typeof SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken
    | typeof SyntaxKind.GreaterThanGreaterThanEqualsToken;
  declare type AssignmentOperator =
    | typeof SyntaxKind.EqualsToken
    | CompoundAssignmentOperator;
  declare type AssignmentOperatorOrHigher =
    | LogicalOperatorOrHigher
    | AssignmentOperator;
  declare type BinaryOperator =
    | AssignmentOperatorOrHigher
    | typeof SyntaxKind.CommaToken;
  declare type BinaryOperatorToken = Token<BinaryOperator>;
  declare type BinaryExpression = {
    ...$Exact<Expression>,
    ...$Exact<Declaration>,
    kind: typeof SyntaxKind.BinaryExpression,
    left: Expression,
    operatorToken: BinaryOperatorToken,
    right: Expression,
    ...
  };

  declare type AssignmentOperatorToken = Token<AssignmentOperator>;
  declare type AssignmentExpression<TOperator: AssignmentOperatorToken> = {
    ...$Exact<BinaryExpression>,
    left: LeftHandSideExpression,
    operatorToken: TOperator,
    ...
  };

  declare type ObjectDestructuringAssignment = {
    ...$Exact<AssignmentExpression<EqualsToken>>,
    left: ObjectLiteralExpression,
    ...
  };

  declare type ArrayDestructuringAssignment = {
    ...$Exact<AssignmentExpression<EqualsToken>>,
    left: ArrayLiteralExpression,
    ...
  };

  declare type DestructuringAssignment =
    | ObjectDestructuringAssignment
    | ArrayDestructuringAssignment;
  declare type BindingOrAssignmentElement =
    | VariableDeclaration
    | ParameterDeclaration
    | BindingElement
    | PropertyAssignment
    | ShorthandPropertyAssignment
    | SpreadAssignment
    | OmittedExpression
    | SpreadElement
    | ArrayLiteralExpression
    | ObjectLiteralExpression
    | AssignmentExpression<EqualsToken>
    | Identifier
    | PropertyAccessExpression
    | ElementAccessExpression;
  declare type BindingOrAssignmentElementRestIndicator =
    | DotDotDotToken
    | SpreadElement
    | SpreadAssignment;
  declare type BindingOrAssignmentElementTarget =
    | BindingOrAssignmentPattern
    | Identifier
    | PropertyAccessExpression
    | ElementAccessExpression
    | OmittedExpression;
  declare type ObjectBindingOrAssignmentPattern =
    | ObjectBindingPattern
    | ObjectLiteralExpression;
  declare type ArrayBindingOrAssignmentPattern =
    | ArrayBindingPattern
    | ArrayLiteralExpression;
  declare type AssignmentPattern =
    | ObjectLiteralExpression
    | ArrayLiteralExpression;
  declare type BindingOrAssignmentPattern =
    | ObjectBindingOrAssignmentPattern
    | ArrayBindingOrAssignmentPattern;
  declare type ConditionalExpression = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.ConditionalExpression,
    condition: Expression,
    questionToken: QuestionToken,
    whenTrue: Expression,
    colonToken: ColonToken,
    whenFalse: Expression,
    ...
  };

  declare type FunctionBody = Block;
  declare type ConciseBody = FunctionBody | Expression;
  declare type FunctionExpression = {
    ...$Exact<PrimaryExpression>,
    ...$Exact<FunctionLikeDeclarationBase>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.FunctionExpression,
    name?: Identifier,
    body: FunctionBody,
    ...
  };

  declare type ArrowFunction = {
    ...$Exact<Expression>,
    ...$Exact<FunctionLikeDeclarationBase>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.ArrowFunction,
    equalsGreaterThanToken: EqualsGreaterThanToken,
    body: ConciseBody,
    name: empty,
    ...
  };

  declare type LiteralLikeNode = {
    ...$Exact<Node>,
    text: string,
    isUnterminated?: boolean,
    hasExtendedUnicodeEscape?: boolean,
    ...
  };

  declare type LiteralExpression = {
    ...$Exact<LiteralLikeNode>,
    ...$Exact<PrimaryExpression>,
    _literalExpressionBrand: any,
    ...
  };

  declare type RegularExpressionLiteral = {
    ...$Exact<LiteralExpression>,
    kind: typeof SyntaxKind.RegularExpressionLiteral,
    ...
  };

  declare type NoSubstitutionTemplateLiteral = {
    ...$Exact<LiteralExpression>,
    kind: typeof SyntaxKind.NoSubstitutionTemplateLiteral,
    ...
  };

  declare type NumericLiteral = {
    ...$Exact<LiteralExpression>,
    kind: typeof SyntaxKind.NumericLiteral,
    ...
  };

  declare type BigIntLiteral = {
    ...$Exact<LiteralExpression>,
    kind: typeof SyntaxKind.BigIntLiteral,
    ...
  };

  declare type TemplateHead = {
    ...$Exact<LiteralLikeNode>,
    kind: typeof SyntaxKind.TemplateHead,
    parent: TemplateExpression,
    ...
  };

  declare type TemplateMiddle = {
    ...$Exact<LiteralLikeNode>,
    kind: typeof SyntaxKind.TemplateMiddle,
    parent: TemplateSpan,
    ...
  };

  declare type TemplateTail = {
    ...$Exact<LiteralLikeNode>,
    kind: typeof SyntaxKind.TemplateTail,
    parent: TemplateSpan,
    ...
  };

  declare type TemplateLiteral =
    | TemplateExpression
    | NoSubstitutionTemplateLiteral;
  declare type TemplateExpression = {
    ...$Exact<PrimaryExpression>,
    kind: typeof SyntaxKind.TemplateExpression,
    head: TemplateHead,
    templateSpans: NodeArray<TemplateSpan>,
    ...
  };

  declare type TemplateSpan = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.TemplateSpan,
    parent: TemplateExpression,
    expression: Expression,
    literal: TemplateMiddle | TemplateTail,
    ...
  };

  declare type ParenthesizedExpression = {
    ...$Exact<PrimaryExpression>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.ParenthesizedExpression,
    expression: Expression,
    ...
  };

  declare type ArrayLiteralExpression = {
    ...$Exact<PrimaryExpression>,
    kind: typeof SyntaxKind.ArrayLiteralExpression,
    elements: NodeArray<Expression>,
    ...
  };

  declare type SpreadElement = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.SpreadElement,
    parent: ArrayLiteralExpression | CallExpression | NewExpression,
    expression: Expression,
    ...
  };

  declare type ObjectLiteralExpressionBase<T: ObjectLiteralElement> = {
    ...$Exact<PrimaryExpression>,
    ...$Exact<Declaration>,
    properties: NodeArray<T>,
    ...
  };

  declare type ObjectLiteralExpression = {
    ...$Exact<ObjectLiteralExpressionBase<ObjectLiteralElementLike>>,
    kind: typeof SyntaxKind.ObjectLiteralExpression,
    ...
  };

  declare type EntityNameExpression =
    | Identifier
    | PropertyAccessEntityNameExpression;
  declare type EntityNameOrEntityNameExpression =
    | EntityName
    | EntityNameExpression;
  declare type PropertyAccessExpression = {
    ...$Exact<MemberExpression>,
    ...$Exact<NamedDeclaration>,
    kind: typeof SyntaxKind.PropertyAccessExpression,
    expression: LeftHandSideExpression,
    name: Identifier,
    ...
  };

  declare type SuperPropertyAccessExpression = {
    ...$Exact<PropertyAccessExpression>,
    expression: SuperExpression,
    ...
  };

  declare type PropertyAccessEntityNameExpression = {
    ...$Exact<PropertyAccessExpression>,
    _propertyAccessExpressionLikeQualifiedNameBrand?: any,
    expression: EntityNameExpression,
    ...
  };

  declare type ElementAccessExpression = {
    ...$Exact<MemberExpression>,
    kind: typeof SyntaxKind.ElementAccessExpression,
    expression: LeftHandSideExpression,
    argumentExpression: Expression,
    ...
  };

  declare type SuperElementAccessExpression = {
    ...$Exact<ElementAccessExpression>,
    expression: SuperExpression,
    ...
  };

  declare type SuperProperty =
    | SuperPropertyAccessExpression
    | SuperElementAccessExpression;
  declare type CallExpression = {
    ...$Exact<LeftHandSideExpression>,
    ...$Exact<Declaration>,
    kind: typeof SyntaxKind.CallExpression,
    expression: LeftHandSideExpression,
    typeArguments?: NodeArray<TypeNode>,
    arguments: NodeArray<Expression>,
    ...
  };

  declare type SuperCall = {
    ...$Exact<CallExpression>,
    expression: SuperExpression,
    ...
  };

  declare type ImportCall = {
    ...$Exact<CallExpression>,
    expression: ImportExpression,
    ...
  };

  declare type ExpressionWithTypeArguments = {
    ...$Exact<NodeWithTypeArguments>,
    kind: typeof SyntaxKind.ExpressionWithTypeArguments,
    parent: HeritageClause | JSDocAugmentsTag,
    expression: LeftHandSideExpression,
    ...
  };

  declare type NewExpression = {
    ...$Exact<PrimaryExpression>,
    ...$Exact<Declaration>,
    kind: typeof SyntaxKind.NewExpression,
    expression: LeftHandSideExpression,
    typeArguments?: NodeArray<TypeNode>,
    arguments?: NodeArray<Expression>,
    ...
  };

  declare type TaggedTemplateExpression = {
    ...$Exact<MemberExpression>,
    kind: typeof SyntaxKind.TaggedTemplateExpression,
    tag: LeftHandSideExpression,
    typeArguments?: NodeArray<TypeNode>,
    template: TemplateLiteral,
    ...
  };

  declare type CallLikeExpression =
    | CallExpression
    | NewExpression
    | TaggedTemplateExpression
    | Decorator
    | JsxOpeningLikeElement;
  declare type AsExpression = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.AsExpression,
    expression: Expression,
    type: TypeNode,
    ...
  };

  declare type TypeAssertion = {
    ...$Exact<UnaryExpression>,
    kind: typeof SyntaxKind.TypeAssertionExpression,
    type: TypeNode,
    expression: UnaryExpression,
    ...
  };

  declare type AssertionExpression = TypeAssertion | AsExpression;
  declare type NonNullExpression = {
    ...$Exact<LeftHandSideExpression>,
    kind: typeof SyntaxKind.NonNullExpression,
    expression: Expression,
    ...
  };

  declare type MetaProperty = {
    ...$Exact<PrimaryExpression>,
    kind: typeof SyntaxKind.MetaProperty,
    keywordToken:
      | typeof SyntaxKind.NewKeyword
      | typeof SyntaxKind.ImportKeyword,
    name: Identifier,
    ...
  };

  declare type JsxElement = {
    ...$Exact<PrimaryExpression>,
    kind: typeof SyntaxKind.JsxElement,
    openingElement: JsxOpeningElement,
    children: NodeArray<JsxChild>,
    closingElement: JsxClosingElement,
    ...
  };

  declare type JsxOpeningLikeElement =
    | JsxSelfClosingElement
    | JsxOpeningElement;
  declare type JsxAttributeLike = JsxAttribute | JsxSpreadAttribute;
  declare type JsxTagNameExpression =
    | Identifier
    | ThisExpression
    | JsxTagNamePropertyAccess;
  declare type JsxTagNamePropertyAccess = {
    ...$Exact<PropertyAccessExpression>,
    expression: JsxTagNameExpression,
    ...
  };

  declare type JsxAttributes = {
    ...$Exact<ObjectLiteralExpressionBase<JsxAttributeLike>>,
    parent: JsxOpeningLikeElement,
    ...
  };

  declare type JsxOpeningElement = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.JsxOpeningElement,
    parent: JsxElement,
    tagName: JsxTagNameExpression,
    typeArguments?: NodeArray<TypeNode>,
    attributes: JsxAttributes,
    ...
  };

  declare type JsxSelfClosingElement = {
    ...$Exact<PrimaryExpression>,
    kind: typeof SyntaxKind.JsxSelfClosingElement,
    tagName: JsxTagNameExpression,
    typeArguments?: NodeArray<TypeNode>,
    attributes: JsxAttributes,
    ...
  };

  declare type JsxFragment = {
    ...$Exact<PrimaryExpression>,
    kind: typeof SyntaxKind.JsxFragment,
    openingFragment: JsxOpeningFragment,
    children: NodeArray<JsxChild>,
    closingFragment: JsxClosingFragment,
    ...
  };

  declare type JsxOpeningFragment = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.JsxOpeningFragment,
    parent: JsxFragment,
    ...
  };

  declare type JsxClosingFragment = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.JsxClosingFragment,
    parent: JsxFragment,
    ...
  };

  declare type JsxAttribute = {
    ...$Exact<ObjectLiteralElement>,
    kind: typeof SyntaxKind.JsxAttribute,
    parent: JsxAttributes,
    name: Identifier,
    initializer?: StringLiteral | JsxExpression,
    ...
  };

  declare type JsxSpreadAttribute = {
    ...$Exact<ObjectLiteralElement>,
    kind: typeof SyntaxKind.JsxSpreadAttribute,
    parent: JsxAttributes,
    expression: Expression,
    ...
  };

  declare type JsxClosingElement = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.JsxClosingElement,
    parent: JsxElement,
    tagName: JsxTagNameExpression,
    ...
  };

  declare type JsxExpression = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.JsxExpression,
    parent: JsxElement | JsxAttributeLike,
    dotDotDotToken?: Token<typeof SyntaxKind.DotDotDotToken>,
    expression?: Expression,
    ...
  };

  declare type JsxText = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.JsxText,
    containsOnlyWhiteSpaces: boolean,
    parent: JsxElement,
    ...
  };

  declare type JsxChild =
    | JsxText
    | JsxExpression
    | JsxElement
    | JsxSelfClosingElement
    | JsxFragment;
  declare type Statement = {
    ...$Exact<Node>,
    _statementBrand: any,
    ...
  };

  declare type NotEmittedStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.NotEmittedStatement,
    ...
  };

  declare type CommaListExpression = {
    ...$Exact<Expression>,
    kind: typeof SyntaxKind.CommaListExpression,
    elements: NodeArray<Expression>,
    ...
  };

  declare type EmptyStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.EmptyStatement,
    ...
  };

  declare type DebuggerStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.DebuggerStatement,
    ...
  };

  declare type MissingDeclaration = {
    ...$Exact<DeclarationStatement>,
    kind: typeof SyntaxKind.MissingDeclaration,
    name?: Identifier,
    ...
  };

  declare type BlockLike =
    | SourceFile
    | Block
    | ModuleBlock
    | CaseOrDefaultClause;
  declare type Block = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.Block,
    statements: NodeArray<Statement>,
    ...
  };

  declare type VariableStatement = {
    ...$Exact<Statement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.VariableStatement,
    declarationList: VariableDeclarationList,
    ...
  };

  declare type ExpressionStatement = {
    ...$Exact<Statement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.ExpressionStatement,
    expression: Expression,
    ...
  };

  declare type IfStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.IfStatement,
    expression: Expression,
    thenStatement: Statement,
    elseStatement?: Statement,
    ...
  };

  declare type IterationStatement = {
    ...$Exact<Statement>,
    statement: Statement,
    ...
  };

  declare type DoStatement = {
    ...$Exact<IterationStatement>,
    kind: typeof SyntaxKind.DoStatement,
    expression: Expression,
    ...
  };

  declare type WhileStatement = {
    ...$Exact<IterationStatement>,
    kind: typeof SyntaxKind.WhileStatement,
    expression: Expression,
    ...
  };

  declare type ForInitializer = VariableDeclarationList | Expression;
  declare type ForStatement = {
    ...$Exact<IterationStatement>,
    kind: typeof SyntaxKind.ForStatement,
    initializer?: ForInitializer,
    condition?: Expression,
    incrementor?: Expression,
    ...
  };

  declare type ForInOrOfStatement = ForInStatement | ForOfStatement;
  declare type ForInStatement = {
    ...$Exact<IterationStatement>,
    kind: typeof SyntaxKind.ForInStatement,
    initializer: ForInitializer,
    expression: Expression,
    ...
  };

  declare type ForOfStatement = {
    ...$Exact<IterationStatement>,
    kind: typeof SyntaxKind.ForOfStatement,
    awaitModifier?: AwaitKeywordToken,
    initializer: ForInitializer,
    expression: Expression,
    ...
  };

  declare type BreakStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.BreakStatement,
    label?: Identifier,
    ...
  };

  declare type ContinueStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.ContinueStatement,
    label?: Identifier,
    ...
  };

  declare type BreakOrContinueStatement = BreakStatement | ContinueStatement;
  declare type ReturnStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.ReturnStatement,
    expression?: Expression,
    ...
  };

  declare type WithStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.WithStatement,
    expression: Expression,
    statement: Statement,
    ...
  };

  declare type SwitchStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.SwitchStatement,
    expression: Expression,
    caseBlock: CaseBlock,
    possiblyExhaustive?: boolean,
    ...
  };

  declare type CaseBlock = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.CaseBlock,
    parent: SwitchStatement,
    clauses: NodeArray<CaseOrDefaultClause>,
    ...
  };

  declare type CaseClause = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.CaseClause,
    parent: CaseBlock,
    expression: Expression,
    statements: NodeArray<Statement>,
    ...
  };

  declare type DefaultClause = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.DefaultClause,
    parent: CaseBlock,
    statements: NodeArray<Statement>,
    ...
  };

  declare type CaseOrDefaultClause = CaseClause | DefaultClause;
  declare type LabeledStatement = {
    ...$Exact<Statement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.LabeledStatement,
    label: Identifier,
    statement: Statement,
    ...
  };

  declare type ThrowStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.ThrowStatement,
    expression?: Expression,
    ...
  };

  declare type TryStatement = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.TryStatement,
    tryBlock: Block,
    catchClause?: CatchClause,
    finallyBlock?: Block,
    ...
  };

  declare type CatchClause = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.CatchClause,
    parent: TryStatement,
    variableDeclaration?: VariableDeclaration,
    block: Block,
    ...
  };

  declare type ObjectTypeDeclaration =
    | ClassLikeDeclaration
    | InterfaceDeclaration
    | TypeLiteralNode;
  declare type DeclarationWithTypeParameters =
    | DeclarationWithTypeParameterChildren
    | JSDocTypedefTag
    | JSDocCallbackTag
    | JSDocSignature;
  declare type DeclarationWithTypeParameterChildren =
    | SignatureDeclaration
    | ClassLikeDeclaration
    | InterfaceDeclaration
    | TypeAliasDeclaration
    | JSDocTemplateTag;
  declare type ClassLikeDeclarationBase = {
    ...$Exact<NamedDeclaration>,
    ...$Exact<JSDocContainer>,
    kind:
      | typeof SyntaxKind.ClassDeclaration
      | typeof SyntaxKind.ClassExpression,
    name?: Identifier,
    typeParameters?: NodeArray<TypeParameterDeclaration>,
    heritageClauses?: NodeArray<HeritageClause>,
    members: NodeArray<ClassElement>,
    ...
  };

  declare type ClassDeclaration = {
    ...$Exact<ClassLikeDeclarationBase>,
    ...$Exact<DeclarationStatement>,
    kind: typeof SyntaxKind.ClassDeclaration,
    name?: Identifier,
    ...
  };

  declare type ClassExpression = {
    ...$Exact<ClassLikeDeclarationBase>,
    ...$Exact<PrimaryExpression>,
    kind: typeof SyntaxKind.ClassExpression,
    ...
  };

  declare type ClassLikeDeclaration = ClassDeclaration | ClassExpression;
  declare type ClassElement = {
    ...$Exact<NamedDeclaration>,
    _classElementBrand: any,
    name?: PropertyName,
    ...
  };

  declare type TypeElement = {
    ...$Exact<NamedDeclaration>,
    _typeElementBrand: any,
    name?: PropertyName,
    questionToken?: QuestionToken,
    ...
  };

  declare type InterfaceDeclaration = {
    ...$Exact<DeclarationStatement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.InterfaceDeclaration,
    name: Identifier,
    typeParameters?: NodeArray<TypeParameterDeclaration>,
    heritageClauses?: NodeArray<HeritageClause>,
    members: NodeArray<TypeElement>,
    ...
  };

  declare type HeritageClause = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.HeritageClause,
    parent: InterfaceDeclaration | ClassLikeDeclaration,
    token:
      | typeof SyntaxKind.ExtendsKeyword
      | typeof SyntaxKind.ImplementsKeyword,
    types: NodeArray<ExpressionWithTypeArguments>,
    ...
  };

  declare type TypeAliasDeclaration = {
    ...$Exact<DeclarationStatement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.TypeAliasDeclaration,
    name: Identifier,
    typeParameters?: NodeArray<TypeParameterDeclaration>,
    type: TypeNode,
    ...
  };

  declare type EnumMember = {
    ...$Exact<NamedDeclaration>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.EnumMember,
    parent: EnumDeclaration,
    name: PropertyName,
    initializer?: Expression,
    ...
  };

  declare type EnumDeclaration = {
    ...$Exact<DeclarationStatement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.EnumDeclaration,
    name: Identifier,
    members: NodeArray<EnumMember>,
    ...
  };

  declare type ModuleName = Identifier | StringLiteral;
  declare type ModuleBody = NamespaceBody | JSDocNamespaceBody;
  declare type ModuleDeclaration = {
    ...$Exact<DeclarationStatement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.ModuleDeclaration,
    parent: ModuleBody | SourceFile,
    name: ModuleName,
    body?: ModuleBody | JSDocNamespaceDeclaration,
    ...
  };

  declare type NamespaceBody = ModuleBlock | NamespaceDeclaration;
  declare type NamespaceDeclaration = {
    ...$Exact<ModuleDeclaration>,
    name: Identifier,
    body: NamespaceBody,
    ...
  };

  declare type JSDocNamespaceBody = Identifier | JSDocNamespaceDeclaration;
  declare type JSDocNamespaceDeclaration = {
    ...$Exact<ModuleDeclaration>,
    name: Identifier,
    body?: JSDocNamespaceBody,
    ...
  };

  declare type ModuleBlock = {
    ...$Exact<Node>,
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.ModuleBlock,
    parent: ModuleDeclaration,
    statements: NodeArray<Statement>,
    ...
  };

  declare type ModuleReference = EntityName | ExternalModuleReference;
  declare type ImportEqualsDeclaration = {
    ...$Exact<DeclarationStatement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.ImportEqualsDeclaration,
    parent: SourceFile | ModuleBlock,
    name: Identifier,
    moduleReference: ModuleReference,
    ...
  };

  declare type ExternalModuleReference = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.ExternalModuleReference,
    parent: ImportEqualsDeclaration,
    expression: Expression,
    ...
  };

  declare type ImportDeclaration = {
    ...$Exact<Statement>,
    kind: typeof SyntaxKind.ImportDeclaration,
    parent: SourceFile | ModuleBlock,
    importClause?: ImportClause,
    moduleSpecifier: Expression,
    ...
  };

  declare type NamedImportBindings = NamespaceImport | NamedImports;
  declare type ImportClause = {
    ...$Exact<NamedDeclaration>,
    kind: typeof SyntaxKind.ImportClause,
    parent: ImportDeclaration,
    name?: Identifier,
    namedBindings?: NamedImportBindings,
    ...
  };

  declare type NamespaceImport = {
    ...$Exact<NamedDeclaration>,
    kind: typeof SyntaxKind.NamespaceImport,
    parent: ImportClause,
    name: Identifier,
    ...
  };

  declare type NamespaceExportDeclaration = {
    ...$Exact<DeclarationStatement>,
    kind: typeof SyntaxKind.NamespaceExportDeclaration,
    name: Identifier,
    ...
  };

  declare type ExportDeclaration = {
    ...$Exact<DeclarationStatement>,
    ...$Exact<JSDocContainer>,
    kind: typeof SyntaxKind.ExportDeclaration,
    parent: SourceFile | ModuleBlock,
    exportClause?: NamedExports,
    moduleSpecifier?: Expression,
    ...
  };

  declare type NamedImports = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.NamedImports,
    parent: ImportClause,
    elements: NodeArray<ImportSpecifier>,
    ...
  };

  declare type NamedExports = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.NamedExports,
    parent: ExportDeclaration,
    elements: NodeArray<ExportSpecifier>,
    ...
  };

  declare type NamedImportsOrExports = NamedImports | NamedExports;
  declare type ImportSpecifier = {
    ...$Exact<NamedDeclaration>,
    kind: typeof SyntaxKind.ImportSpecifier,
    parent: NamedImports,
    propertyName?: Identifier,
    name: Identifier,
    ...
  };

  declare type ExportSpecifier = {
    ...$Exact<NamedDeclaration>,
    kind: typeof SyntaxKind.ExportSpecifier,
    parent: NamedExports,
    propertyName?: Identifier,
    name: Identifier,
    ...
  };

  declare type ImportOrExportSpecifier = ImportSpecifier | ExportSpecifier;
  declare type ExportAssignment = {
    ...$Exact<DeclarationStatement>,
    kind: typeof SyntaxKind.ExportAssignment,
    parent: SourceFile,
    isExportEquals?: boolean,
    expression: Expression,
    ...
  };

  declare type FileReference = {
    ...$Exact<TextRange>,
    fileName: string,
    ...
  };

  declare type CheckJsDirective = {
    ...$Exact<TextRange>,
    enabled: boolean,
    ...
  };

  declare type CommentKind =
    | typeof SyntaxKind.SingleLineCommentTrivia
    | typeof SyntaxKind.MultiLineCommentTrivia;
  declare type CommentRange = {
    ...$Exact<TextRange>,
    hasTrailingNewLine?: boolean,
    kind: CommentKind,
    ...
  };

  declare type SynthesizedComment = {
    ...$Exact<CommentRange>,
    text: string,
    pos: -1,
    end: -1,
    ...
  };

  declare type JSDocTypeExpression = {
    ...$Exact<TypeNode>,
    kind: typeof SyntaxKind.JSDocTypeExpression,
    type: TypeNode,
    ...
  };

  declare type JSDocType = {
    ...$Exact<TypeNode>,
    _jsDocTypeBrand: any,
    ...
  };

  declare type JSDocAllType = {
    ...$Exact<JSDocType>,
    kind: typeof SyntaxKind.JSDocAllType,
    ...
  };

  declare type JSDocUnknownType = {
    ...$Exact<JSDocType>,
    kind: typeof SyntaxKind.JSDocUnknownType,
    ...
  };

  declare type JSDocNonNullableType = {
    ...$Exact<JSDocType>,
    kind: typeof SyntaxKind.JSDocNonNullableType,
    type: TypeNode,
    ...
  };

  declare type JSDocNullableType = {
    ...$Exact<JSDocType>,
    kind: typeof SyntaxKind.JSDocNullableType,
    type: TypeNode,
    ...
  };

  declare type JSDocOptionalType = {
    ...$Exact<JSDocType>,
    kind: typeof SyntaxKind.JSDocOptionalType,
    type: TypeNode,
    ...
  };

  declare type JSDocFunctionType = {
    ...$Exact<JSDocType>,
    ...$Exact<SignatureDeclarationBase>,
    kind: typeof SyntaxKind.JSDocFunctionType,
    ...
  };

  declare type JSDocVariadicType = {
    ...$Exact<JSDocType>,
    kind: typeof SyntaxKind.JSDocVariadicType,
    type: TypeNode,
    ...
  };

  declare type JSDocTypeReferencingNode =
    | JSDocVariadicType
    | JSDocOptionalType
    | JSDocNullableType
    | JSDocNonNullableType;
  declare type JSDoc = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.JSDocComment,
    parent: HasJSDoc,
    tags?: NodeArray<JSDocTag>,
    comment?: string,
    ...
  };

  declare type JSDocTag = {
    ...$Exact<Node>,
    parent: JSDoc | JSDocTypeLiteral,
    tagName: Identifier,
    comment?: string,
    ...
  };

  declare type JSDocUnknownTag = {
    ...$Exact<JSDocTag>,
    kind: typeof SyntaxKind.JSDocTag,
    ...
  };

  declare type JSDocAugmentsTag = {
    ...$Exact<JSDocTag>,
    kind: typeof SyntaxKind.JSDocAugmentsTag,
    class: ExpressionWithTypeArguments & { expression: Identifier | PropertyAccessEntityNameExpression, ... },
    ...
  };

  declare type JSDocClassTag = {
    ...$Exact<JSDocTag>,
    kind: typeof SyntaxKind.JSDocClassTag,
    ...
  };

  declare type JSDocEnumTag = {
    ...$Exact<JSDocTag>,
    kind: typeof SyntaxKind.JSDocEnumTag,
    typeExpression?: JSDocTypeExpression,
    ...
  };

  declare type JSDocThisTag = {
    ...$Exact<JSDocTag>,
    kind: typeof SyntaxKind.JSDocThisTag,
    typeExpression?: JSDocTypeExpression,
    ...
  };

  declare type JSDocTemplateTag = {
    ...$Exact<JSDocTag>,
    kind: typeof SyntaxKind.JSDocTemplateTag,
    constraint: JSDocTypeExpression | void,
    typeParameters: NodeArray<TypeParameterDeclaration>,
    ...
  };

  declare type JSDocReturnTag = {
    ...$Exact<JSDocTag>,
    kind: typeof SyntaxKind.JSDocReturnTag,
    typeExpression?: JSDocTypeExpression,
    ...
  };

  declare type JSDocTypeTag = {
    ...$Exact<JSDocTag>,
    kind: typeof SyntaxKind.JSDocTypeTag,
    typeExpression?: JSDocTypeExpression,
    ...
  };

  declare type JSDocTypedefTag = {
    ...$Exact<JSDocTag>,
    ...$Exact<NamedDeclaration>,
    parent: JSDoc,
    kind: typeof SyntaxKind.JSDocTypedefTag,
    fullName?: JSDocNamespaceDeclaration | Identifier,
    name?: Identifier,
    typeExpression?: JSDocTypeExpression | JSDocTypeLiteral,
    ...
  };

  declare type JSDocCallbackTag = {
    ...$Exact<JSDocTag>,
    ...$Exact<NamedDeclaration>,
    parent: JSDoc,
    kind: typeof SyntaxKind.JSDocCallbackTag,
    fullName?: JSDocNamespaceDeclaration | Identifier,
    name?: Identifier,
    typeExpression: JSDocSignature,
    ...
  };

  declare type JSDocSignature = {
    ...$Exact<JSDocType>,
    ...$Exact<Declaration>,
    kind: typeof SyntaxKind.JSDocSignature,
    typeParameters?: $ReadOnlyArray<JSDocTemplateTag>,
    parameters: $ReadOnlyArray<JSDocParameterTag>,
    type: JSDocReturnTag | void,
    ...
  };

  declare type JSDocPropertyLikeTag = {
    ...$Exact<JSDocTag>,
    ...$Exact<Declaration>,
    parent: JSDoc,
    name: EntityName,
    typeExpression?: JSDocTypeExpression,
    isNameFirst: boolean,
    isBracketed: boolean,
    ...
  };

  declare type JSDocPropertyTag = {
    ...$Exact<JSDocPropertyLikeTag>,
    kind: typeof SyntaxKind.JSDocPropertyTag,
    ...
  };

  declare type JSDocParameterTag = {
    ...$Exact<JSDocPropertyLikeTag>,
    kind: typeof SyntaxKind.JSDocParameterTag,
    ...
  };

  declare type JSDocTypeLiteral = {
    ...$Exact<JSDocType>,
    kind: typeof SyntaxKind.JSDocTypeLiteral,
    jsDocPropertyTags?: $ReadOnlyArray<JSDocPropertyLikeTag>,
    isArrayType?: boolean,
    ...
  };

  declare var FlowFlags: {
    // 1
    +Unreachable: 1,
    // 2
    +Start: 2,
    // 4
    +BranchLabel: 4,
    // 8
    +LoopLabel: 8,
    // 16
    +Assignment: 16,
    // 32
    +TrueCondition: 32,
    // 64
    +FalseCondition: 64,
    // 128
    +SwitchClause: 128,
    // 256
    +ArrayMutation: 256,
    // 512
    +Referenced: 512,
    // 1024
    +Shared: 1024,
    // 2048
    +PreFinally: 2048,
    // 4096
    +AfterFinally: 4096,
    // 12
    +Label: 12,
    // 96
    +Condition: 96,
    ...
  };

  declare type FlowLock = { locked?: boolean, ... };

  declare type AfterFinallyFlow = {
    ...$Exact<FlowNodeBase>,
    ...$Exact<FlowLock>,
    antecedent: FlowNode,
    ...
  };

  declare type PreFinallyFlow = {
    ...$Exact<FlowNodeBase>,
    antecedent: FlowNode,
    lock: FlowLock,
    ...
  };

  declare type FlowNode =
    | AfterFinallyFlow
    | PreFinallyFlow
    | FlowStart
    | FlowLabel
    | FlowAssignment
    | FlowCondition
    | FlowSwitchClause
    | FlowArrayMutation;
  declare type FlowNodeBase = {
    flags: $Values<typeof FlowFlags>,
    id?: number,
    ...
  };

  declare type FlowStart = {
    ...$Exact<FlowNodeBase>,
    container?: FunctionExpression | ArrowFunction | MethodDeclaration,
    ...
  };

  declare type FlowLabel = {
    ...$Exact<FlowNodeBase>,
    antecedents: FlowNode[] | void,
    ...
  };

  declare type FlowAssignment = {
    ...$Exact<FlowNodeBase>,
    node: Expression | VariableDeclaration | BindingElement,
    antecedent: FlowNode,
    ...
  };

  declare type FlowCondition = {
    ...$Exact<FlowNodeBase>,
    expression: Expression,
    antecedent: FlowNode,
    ...
  };

  declare type FlowSwitchClause = {
    ...$Exact<FlowNodeBase>,
    switchStatement: SwitchStatement,
    clauseStart: number,
    clauseEnd: number,
    antecedent: FlowNode,
    ...
  };

  declare type FlowArrayMutation = {
    ...$Exact<FlowNodeBase>,
    node: CallExpression | BinaryExpression,
    antecedent: FlowNode,
    ...
  };

  declare type FlowType = Type | IncompleteType;
  declare type IncompleteType = {
    flags: $Values<typeof TypeFlags>,
    type: Type,
    ...
  };

  declare type AmdDependency = {
    path: string,
    name?: string,
    ...
  };

  declare type SourceFile = {
    ...$Exact<Declaration>,
    kind: typeof SyntaxKind.SourceFile,
    statements: NodeArray<Statement>,
    endOfFileToken: Token<typeof SyntaxKind.EndOfFileToken>,
    fileName: string,
    text: string,
    amdDependencies: $ReadOnlyArray<AmdDependency>,
    moduleName?: string,
    referencedFiles: $ReadOnlyArray<FileReference>,
    typeReferenceDirectives: $ReadOnlyArray<FileReference>,
    libReferenceDirectives: $ReadOnlyArray<FileReference>,
    languageVariant: $Values<typeof LanguageVariant>,
    isDeclarationFile: boolean,
    hasNoDefaultLib: boolean,
    languageVersion: $Values<typeof ScriptTarget>,
    getLineAndCharacterOfPosition(pos: number): LineAndCharacter,
    getLineEndOfPosition(pos: number): number,
    getLineStarts(): $ReadOnlyArray<number>,
    getPositionOfLineAndCharacter(line: number, character: number): number,
    update(newText: string, textChangeRange: TextChangeRange): SourceFile,
    ...
  };

  declare type Bundle = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.Bundle,
    prepends: $ReadOnlyArray<InputFiles | UnparsedSource>,
    sourceFiles: $ReadOnlyArray<SourceFile>,
    ...
  };

  declare type InputFiles = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.InputFiles,
    javascriptPath?: string,
    javascriptText: string,
    javascriptMapPath?: string,
    javascriptMapText?: string,
    declarationPath?: string,
    declarationText: string,
    declarationMapPath?: string,
    declarationMapText?: string,
    ...
  };

  declare type UnparsedSource = {
    ...$Exact<Node>,
    kind: typeof SyntaxKind.UnparsedSource,
    fileName?: string,
    text: string,
    sourceMapPath?: string,
    sourceMapText?: string,
    ...
  };

  declare type JsonSourceFile = {
    ...$Exact<SourceFile>,
    statements: NodeArray<JsonObjectExpressionStatement>,
    ...
  };

  declare type TsConfigSourceFile = {
    ...$Exact<JsonSourceFile>,
    extendedSourceFiles?: string[],
    ...
  };

  declare type JsonMinusNumericLiteral = {
    ...$Exact<PrefixUnaryExpression>,
    kind: typeof SyntaxKind.PrefixUnaryExpression,
    operator: typeof SyntaxKind.MinusToken,
    operand: NumericLiteral,
    ...
  };

  declare type JsonObjectExpressionStatement = {
    ...$Exact<ExpressionStatement>,
    expression:
      | ObjectLiteralExpression
      | ArrayLiteralExpression
      | JsonMinusNumericLiteral
      | NumericLiteral
      | StringLiteral
      | BooleanLiteral
      | NullLiteral,
    ...
  };

  declare type ScriptReferenceHost = {
    getCompilerOptions(): CompilerOptions,
    getSourceFile(fileName: string): SourceFile | void,
    getSourceFileByPath(path: Path): SourceFile | void,
    getCurrentDirectory(): string,
    ...
  };

  declare type ParseConfigHost = {
    useCaseSensitiveFileNames: boolean,
    readDirectory(
      rootDir: string,
      extensions: $ReadOnlyArray<string>,
      excludes: $ReadOnlyArray<string> | void,
      includes: $ReadOnlyArray<string>,
      depth?: number
    ): $ReadOnlyArray<string>,
    fileExists(path: string): boolean,
    readFile(path: string): string | void,
    trace?: (s: string) => void,
    ...
  };

  declare type ResolvedConfigFileName = string & { _isResolvedConfigFileName: empty, ... };
  declare type WriteFileCallback = (
    fileName: string,
    data: string,
    writeByteOrderMark: boolean,
    onError?: (message: string) => void,
    sourceFiles?: $ReadOnlyArray<SourceFile>
  ) => void;
  declare class OperationCanceledException {}
  declare type CancellationToken = {
    isCancellationRequested(): boolean,
    throwIfCancellationRequested(): void,
    ...
  };

  declare type Program = {
    ...$Exact<ScriptReferenceHost>,
    getRootFileNames(): $ReadOnlyArray<string>,
    getSourceFiles(): $ReadOnlyArray<SourceFile>,
    emit(
      targetSourceFile?: SourceFile,
      writeFile?: WriteFileCallback,
      cancellationToken?: CancellationToken,
      emitOnlyDtsFiles?: boolean,
      customTransformers?: CustomTransformers
    ): EmitResult,
    getOptionsDiagnostics(
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<Diagnostic>,
    getGlobalDiagnostics(
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<Diagnostic>,
    getSyntacticDiagnostics(
      sourceFile?: SourceFile,
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<DiagnosticWithLocation>,
    getSemanticDiagnostics(
      sourceFile?: SourceFile,
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<Diagnostic>,
    getDeclarationDiagnostics(
      sourceFile?: SourceFile,
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<DiagnosticWithLocation>,
    getConfigFileParsingDiagnostics(): $ReadOnlyArray<Diagnostic>,
    getTypeChecker(): TypeChecker,
    isSourceFileFromExternalLibrary(file: SourceFile): boolean,
    isSourceFileDefaultLibrary(file: SourceFile): boolean,
    getProjectReferences(): $ReadOnlyArray<ProjectReference> | void,
    getResolvedProjectReferences(): $ReadOnlyArray<ResolvedProjectReference | void> | void,
    ...
  };

  declare type ResolvedProjectReference = {
    commandLine: ParsedCommandLine,
    sourceFile: SourceFile,
    references?: $ReadOnlyArray<ResolvedProjectReference | void>,
    ...
  };

  declare type CustomTransformers = {
    before?: TransformerFactory<SourceFile>[],
    after?: TransformerFactory<SourceFile>[],
    afterDeclarations?: TransformerFactory<Bundle | SourceFile>[],
    ...
  };

  declare type SourceMapSpan = {
    emittedLine: number,
    emittedColumn: number,
    sourceLine: number,
    sourceColumn: number,
    nameIndex?: number,
    sourceIndex: number,
    ...
  };

  declare var ExitStatus: {
    // 0
    +Success: 0,
    // 1
    +DiagnosticsPresent_OutputsSkipped: 1,
    // 2
    +DiagnosticsPresent_OutputsGenerated: 2,
    ...
  };

  declare type EmitResult = {
    emitSkipped: boolean,
    diagnostics: $ReadOnlyArray<Diagnostic>,
    emittedFiles?: string[],
    ...
  };

  declare type TypeChecker = {
    getTypeOfSymbolAtLocation(symbol: Symbol, node: Node): Type,
    getDeclaredTypeOfSymbol(symbol: Symbol): Type,
    getPropertiesOfType(type: Type): Symbol[],
    getPropertyOfType(type: Type, propertyName: string): Symbol | void,
    getIndexInfoOfType(
      type: Type,
      kind: $Values<typeof IndexKind>
    ): IndexInfo | void,
    getSignaturesOfType(
      type: Type,
      kind: $Values<typeof SignatureKind>
    ): $ReadOnlyArray<Signature>,
    getIndexTypeOfType(
      type: Type,
      kind: $Values<typeof IndexKind>
    ): Type | void,
    getBaseTypes(type: InterfaceType): BaseType[],
    getBaseTypeOfLiteralType(type: Type): Type,
    getWidenedType(type: Type): Type,
    getReturnTypeOfSignature(signature: Signature): Type,
    getNullableType(type: Type, flags: $Values<typeof TypeFlags>): Type,
    getNonNullableType(type: Type): Type,
    typeToTypeNode(
      type: Type,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof NodeBuilderFlags>
    ): TypeNode | void,
    signatureToSignatureDeclaration(
      signature: Signature,
      kind: $Values<typeof SyntaxKind>,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof NodeBuilderFlags>
    ):
      | (SignatureDeclaration & { typeArguments?: NodeArray<TypeNode>, ... })
      | void,
    indexInfoToIndexSignatureDeclaration(
      indexInfo: IndexInfo,
      kind: $Values<typeof IndexKind>,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof NodeBuilderFlags>
    ): IndexSignatureDeclaration | void,
    symbolToEntityName(
      symbol: Symbol,
      meaning: $Values<typeof SymbolFlags>,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof NodeBuilderFlags>
    ): EntityName | void,
    symbolToExpression(
      symbol: Symbol,
      meaning: $Values<typeof SymbolFlags>,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof NodeBuilderFlags>
    ): Expression | void,
    symbolToTypeParameterDeclarations(
      symbol: Symbol,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof NodeBuilderFlags>
    ): NodeArray<TypeParameterDeclaration> | void,
    symbolToParameterDeclaration(
      symbol: Symbol,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof NodeBuilderFlags>
    ): ParameterDeclaration | void,
    typeParameterToDeclaration(
      parameter: TypeParameter,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof NodeBuilderFlags>
    ): TypeParameterDeclaration | void,
    getSymbolsInScope(
      location: Node,
      meaning: $Values<typeof SymbolFlags>
    ): Symbol[],
    getSymbolAtLocation(node: Node): Symbol | void,
    getSymbolsOfParameterPropertyDeclaration(
      parameter: ParameterDeclaration,
      parameterName: string
    ): Symbol[],
    getShorthandAssignmentValueSymbol(location: Node): Symbol | void,
    getExportSpecifierLocalTargetSymbol(
      location: ExportSpecifier
    ): Symbol | void,
    getExportSymbolOfSymbol(symbol: Symbol): Symbol,
    getPropertySymbolOfDestructuringAssignment(
      location: Identifier
    ): Symbol | void,
    getTypeAtLocation(node: Node): Type,
    getTypeFromTypeNode(node: TypeNode): Type,
    signatureToString(
      signature: Signature,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof TypeFormatFlags>,
      kind?: $Values<typeof SignatureKind>
    ): string,
    typeToString(
      type: Type,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof TypeFormatFlags>
    ): string,
    symbolToString(
      symbol: Symbol,
      enclosingDeclaration?: Node,
      meaning?: $Values<typeof SymbolFlags>,
      flags?: $Values<typeof SymbolFormatFlags>
    ): string,
    typePredicateToString(
      predicate: TypePredicate,
      enclosingDeclaration?: Node,
      flags?: $Values<typeof TypeFormatFlags>
    ): string,
    getFullyQualifiedName(symbol: Symbol): string,
    getAugmentedPropertiesOfType(type: Type): Symbol[],
    getRootSymbols(symbol: Symbol): $ReadOnlyArray<Symbol>,
    getContextualType(node: Expression): Type | void,
    getResolvedSignature(
      node: CallLikeExpression,
      candidatesOutArray?: Signature[],
      argumentCount?: number
    ): Signature | void,
    getSignatureFromDeclaration(
      declaration: SignatureDeclaration
    ): Signature | void,
    isImplementationOfOverload(node: SignatureDeclaration): boolean | void,
    isUndefinedSymbol(symbol: Symbol): boolean,
    isArgumentsSymbol(symbol: Symbol): boolean,
    isUnknownSymbol(symbol: Symbol): boolean,
    getConstantValue(
      node: EnumMember | PropertyAccessExpression | ElementAccessExpression
    ): string | number | void,
    isValidPropertyAccess(
      node: PropertyAccessExpression | QualifiedName | ImportTypeNode,
      propertyName: string
    ): boolean,
    getAliasedSymbol(symbol: Symbol): Symbol,
    getExportsOfModule(moduleSymbol: Symbol): Symbol[],
    getJsxIntrinsicTagNamesAt(location: Node): Symbol[],
    isOptionalParameter(node: ParameterDeclaration): boolean,
    getAmbientModules(): Symbol[],
    tryGetMemberInModuleExports(
      memberName: string,
      moduleSymbol: Symbol
    ): Symbol | void,
    getApparentType(type: Type): Type,
    getBaseConstraintOfType(type: Type): Type | void,
    getDefaultFromTypeParameter(type: Type): Type | void,
    runWithCancellationToken<T>(
      token: CancellationToken,
      cb: (checker: TypeChecker) => T
    ): T,
    ...
  };

  declare var NodeBuilderFlags: {
    // 0
    +None: 0,
    // 1
    +NoTruncation: 1,
    // 2
    +WriteArrayAsGenericType: 2,
    // 4
    +GenerateNamesForShadowedTypeParams: 4,
    // 8
    +UseStructuralFallback: 8,
    // 16
    +ForbidIndexedAccessSymbolReferences: 16,
    // 32
    +WriteTypeArgumentsOfSignature: 32,
    // 64
    +UseFullyQualifiedType: 64,
    // 128
    +UseOnlyExternalAliasing: 128,
    // 256
    +SuppressAnyReturnType: 256,
    // 512
    +WriteTypeParametersInQualifiedName: 512,
    // 1024
    +MultilineObjectLiterals: 1024,
    // 2048
    +WriteClassExpressionAsTypeLiteral: 2048,
    // 4096
    +UseTypeOfFunction: 4096,
    // 8192
    +OmitParameterModifiers: 8192,
    // 16384
    +UseAliasDefinedOutsideCurrentScope: 16384,
    // 32768
    +AllowThisInObjectLiteral: 32768,
    // 65536
    +AllowQualifedNameInPlaceOfIdentifier: 65536,
    // 131072
    +AllowAnonymousIdentifier: 131072,
    // 262144
    +AllowEmptyUnionOrIntersection: 262144,
    // 524288
    +AllowEmptyTuple: 524288,
    // 1048576
    +AllowUniqueESSymbolType: 1048576,
    // 2097152
    +AllowEmptyIndexInfoType: 2097152,
    // 67108864
    +AllowNodeModulesRelativePaths: 67108864,
    // 70221824
    +IgnoreErrors: 70221824,
    // 4194304
    +InObjectTypeLiteral: 4194304,
    // 8388608
    +InTypeAlias: 8388608,
    // 16777216
    +InInitialEntityName: 16777216,
    // 33554432
    +InReverseMappedType: 33554432,
    ...
  };

  declare var TypeFormatFlags: {
    // 0
    +None: 0,
    // 1
    +NoTruncation: 1,
    // 2
    +WriteArrayAsGenericType: 2,
    // 8
    +UseStructuralFallback: 8,
    // 32
    +WriteTypeArgumentsOfSignature: 32,
    // 64
    +UseFullyQualifiedType: 64,
    // 256
    +SuppressAnyReturnType: 256,
    // 1024
    +MultilineObjectLiterals: 1024,
    // 2048
    +WriteClassExpressionAsTypeLiteral: 2048,
    // 4096
    +UseTypeOfFunction: 4096,
    // 8192
    +OmitParameterModifiers: 8192,
    // 16384
    +UseAliasDefinedOutsideCurrentScope: 16384,
    // 1048576
    +AllowUniqueESSymbolType: 1048576,
    // 131072
    +AddUndefined: 131072,
    // 262144
    +WriteArrowStyleSignature: 262144,
    // 524288
    +InArrayType: 524288,
    // 2097152
    +InElementType: 2097152,
    // 4194304
    +InFirstTypeArgument: 4194304,
    // 8388608
    +InTypeAlias: 8388608,
    // 0
    +WriteOwnNameForAnyLike: 0,
    // 9469291
    +NodeBuilderFlagsMask: 9469291,
    ...
  };

  declare var SymbolFormatFlags: {
    // 0
    +None: 0,
    // 1
    +WriteTypeParametersOrArguments: 1,
    // 2
    +UseOnlyExternalAliasing: 2,
    // 4
    +AllowAnyNodeKind: 4,
    // 8
    +UseAliasDefinedOutsideCurrentScope: 8,
    ...
  };

  declare var TypePredicateKind: {
    // 0
    +This: 0,
    // 1
    +Identifier: 1,
    ...
  };

  declare type TypePredicateBase = {
    kind: $Values<typeof TypePredicateKind>,
    type: Type,
    ...
  };

  declare type ThisTypePredicate = {
    ...$Exact<TypePredicateBase>,
    kind: typeof TypePredicateKind.This,
    ...
  };

  declare type IdentifierTypePredicate = {
    ...$Exact<TypePredicateBase>,
    kind: typeof TypePredicateKind.Identifier,
    parameterName: string,
    parameterIndex: number,
    ...
  };

  declare type TypePredicate = IdentifierTypePredicate | ThisTypePredicate;

  declare var SymbolFlags: {
    // 0
    +None: 0,
    // 1
    +FunctionScopedVariable: 1,
    // 2
    +BlockScopedVariable: 2,
    // 4
    +Property: 4,
    // 8
    +EnumMember: 8,
    // 16
    +Function: 16,
    // 32
    +Class: 32,
    // 64
    +Interface: 64,
    // 128
    +ConstEnum: 128,
    // 256
    +RegularEnum: 256,
    // 512
    +ValueModule: 512,
    // 1024
    +NamespaceModule: 1024,
    // 2048
    +TypeLiteral: 2048,
    // 4096
    +ObjectLiteral: 4096,
    // 8192
    +Method: 8192,
    // 16384
    +Constructor: 16384,
    // 32768
    +GetAccessor: 32768,
    // 65536
    +SetAccessor: 65536,
    // 131072
    +Signature: 131072,
    // 262144
    +TypeParameter: 262144,
    // 524288
    +TypeAlias: 524288,
    // 1048576
    +ExportValue: 1048576,
    // 2097152
    +Alias: 2097152,
    // 4194304
    +Prototype: 4194304,
    // 8388608
    +ExportStar: 8388608,
    // 16777216
    +Optional: 16777216,
    // 33554432
    +Transient: 33554432,
    // 67108864
    +Assignment: 67108864,
    // 134217728
    +ModuleExports: 134217728,
    // 384
    +Enum: 384,
    // 3
    +Variable: 3,
    // 67220415
    +Value: 67220415,
    // 67897832
    +Type: 67897832,
    // 1920
    +Namespace: 1920,
    // 1536
    +Module: 1536,
    // 98304
    +Accessor: 98304,
    // 67220414
    +FunctionScopedVariableExcludes: 67220414,
    // 67220415
    +BlockScopedVariableExcludes: 67220415,
    // 67220415
    +ParameterExcludes: 67220415,
    // 0
    +PropertyExcludes: 0,
    // 68008959
    +EnumMemberExcludes: 68008959,
    // 67219887
    +FunctionExcludes: 67219887,
    // 68008383
    +ClassExcludes: 68008383,
    // 67897736
    +InterfaceExcludes: 67897736,
    // 68008191
    +RegularEnumExcludes: 68008191,
    // 68008831
    +ConstEnumExcludes: 68008831,
    // 110735
    +ValueModuleExcludes: 110735,
    // 0
    +NamespaceModuleExcludes: 0,
    // 67212223
    +MethodExcludes: 67212223,
    // 67154879
    +GetAccessorExcludes: 67154879,
    // 67187647
    +SetAccessorExcludes: 67187647,
    // 67635688
    +TypeParameterExcludes: 67635688,
    // 67897832
    +TypeAliasExcludes: 67897832,
    // 2097152
    +AliasExcludes: 2097152,
    // 2623475
    +ModuleMember: 2623475,
    // 944
    +ExportHasLocal: 944,
    // 418
    +BlockScoped: 418,
    // 98308
    +PropertyOrAccessor: 98308,
    // 106500
    +ClassMember: 106500,
    ...
  };

  declare type Symbol = {
    flags: $Values<typeof SymbolFlags>,
    escapedName: __String,
    declarations: Declaration[],
    valueDeclaration: Declaration,
    members?: SymbolTable,
    exports?: SymbolTable,
    globalExports?: SymbolTable,
    +name: string,
    getFlags(): $Values<typeof SymbolFlags>,
    getEscapedName(): __String,
    getName(): string,
    getDeclarations(): Declaration[] | void,
    getDocumentationComment(
      typeChecker: TypeChecker | void
    ): SymbolDisplayPart[],
    getJsDocTags(): JSDocTagInfo[],
    ...
  };

  declare var InternalSymbolName: {
    // "__call"
    +Call: "__call",
    // "__constructor"
    +Constructor: "__constructor",
    // "__new"
    +New: "__new",
    // "__index"
    +Index: "__index",
    // "__export"
    +ExportStar: "__export",
    // "__global"
    +Global: "__global",
    // "__missing"
    +Missing: "__missing",
    // "__type"
    +Type: "__type",
    // "__object"
    +Object: "__object",
    // "__jsxAttributes"
    +JSXAttributes: "__jsxAttributes",
    // "__class"
    +Class: "__class",
    // "__function"
    +Function: "__function",
    // "__computed"
    +Computed: "__computed",
    // "__resolving__"
    +Resolving: "__resolving__",
    // "export="
    +ExportEquals: "export=",
    // "default"
    +Default: "default",
    // "this"
    +This: "this",
    ...
  };

  declare type __String =
    | (string & { __escapedIdentifier: void, ... })
    | (void & { __escapedIdentifier: void, ... })
    | $Values<typeof InternalSymbolName>;

  declare class ReadonlyUnderscoreEscapedMap<T> {
    get(key: __String): T | void,
    has(key: __String): boolean,
    forEach(action: (value: T, key: __String) => void): void,
    +size: number,
    keys(): Iterator<__String>,
    values(): Iterator<T>,
    entries(): Iterator<[__String, T]>
  }

  declare class UnderscoreEscapedMap<T> extends ReadonlyUnderscoreEscapedMap<T> {
    set(key: __String, value: T): this,
    delete(key: __String): boolean,
    clear(): void
  }

  declare type SymbolTable = UnderscoreEscapedMap<Symbol>;

  declare var TypeFlags: {
    // 1
    +Any: 1,
    // 2
    +Unknown: 2,
    // 4
    +String: 4,
    // 8
    +Number: 8,
    // 16
    +Boolean: 16,
    // 32
    +Enum: 32,
    // 64
    +BigInt: 64,
    // 128
    +StringLiteral: 128,
    // 256
    +NumberLiteral: 256,
    // 512
    +BooleanLiteral: 512,
    // 1024
    +EnumLiteral: 1024,
    // 2048
    +BigIntLiteral: 2048,
    // 4096
    +ESSymbol: 4096,
    // 8192
    +UniqueESSymbol: 8192,
    // 16384
    +Void: 16384,
    // 32768
    +Undefined: 32768,
    // 65536
    +Null: 65536,
    // 131072
    +Never: 131072,
    // 262144
    +TypeParameter: 262144,
    // 524288
    +Object: 524288,
    // 1048576
    +Union: 1048576,
    // 2097152
    +Intersection: 2097152,
    // 4194304
    +Index: 4194304,
    // 8388608
    +IndexedAccess: 8388608,
    // 16777216
    +Conditional: 16777216,
    // 33554432
    +Substitution: 33554432,
    // 67108864
    +NonPrimitive: 67108864,
    // 2944
    +Literal: 2944,
    // 109440
    +Unit: 109440,
    // 384
    +StringOrNumberLiteral: 384,
    // 117724
    +PossiblyFalsy: 117724,
    // 132
    +StringLike: 132,
    // 296
    +NumberLike: 296,
    // 2112
    +BigIntLike: 2112,
    // 528
    +BooleanLike: 528,
    // 1056
    +EnumLike: 1056,
    // 12288
    +ESSymbolLike: 12288,
    // 49152
    +VoidLike: 49152,
    // 3145728
    +UnionOrIntersection: 3145728,
    // 3670016
    +StructuredType: 3670016,
    // 8650752
    +TypeVariable: 8650752,
    // 58982400
    +InstantiableNonPrimitive: 58982400,
    // 4194304
    +InstantiablePrimitive: 4194304,
    // 63176704
    +Instantiable: 63176704,
    // 66846720
    +StructuredOrInstantiable: 66846720,
    // 133970943
    +Narrowable: 133970943,
    // 67637251
    +NotUnionOrUnit: 67637251,
    ...
  };

  declare type DestructuringPattern =
    | BindingPattern
    | ObjectLiteralExpression
    | ArrayLiteralExpression;
  declare type Type = {
    flags: $Values<typeof TypeFlags>,
    symbol: Symbol,
    pattern?: DestructuringPattern,
    aliasSymbol?: Symbol,
    aliasTypeArguments?: $ReadOnlyArray<Type>,
    getFlags(): $Values<typeof TypeFlags>,
    getSymbol(): Symbol | void,
    getProperties(): Symbol[],
    getProperty(propertyName: string): Symbol | void,
    getApparentProperties(): Symbol[],
    getCallSignatures(): $ReadOnlyArray<Signature>,
    getConstructSignatures(): $ReadOnlyArray<Signature>,
    getStringIndexType(): Type | void,
    getNumberIndexType(): Type | void,
    getBaseTypes(): BaseType[] | void,
    getNonNullableType(): Type,
    getConstraint(): Type | void,
    getDefault(): Type | void,
    isUnion(): boolean,
    isIntersection(): boolean,
    isUnionOrIntersection(): boolean,
    isLiteral(): boolean,
    isStringLiteral(): boolean,
    isNumberLiteral(): boolean,
    isTypeParameter(): boolean,
    isClassOrInterface(): boolean,
    isClass(): boolean,
    ...
  };

  declare type LiteralType = {
    ...$Exact<Type>,
    value: string | number | PseudoBigInt,
    freshType: LiteralType,
    regularType: LiteralType,
    ...
  };

  declare type UniqueESSymbolType = {
    ...$Exact<Type>,
    symbol: Symbol,
    escapedName: __String,
    ...
  };

  declare type StringLiteralType = {
    ...$Exact<LiteralType>,
    value: string,
    ...
  };

  declare type NumberLiteralType = {
    ...$Exact<LiteralType>,
    value: number,
    ...
  };

  declare type BigIntLiteralType = {
    ...$Exact<LiteralType>,
    value: PseudoBigInt,
    ...
  };

  declare type EnumType = { ...$Exact<Type>, ... };

  declare var ObjectFlags: {
    // 1
    +Class: 1,
    // 2
    +Interface: 2,
    // 4
    +Reference: 4,
    // 8
    +Tuple: 8,
    // 16
    +Anonymous: 16,
    // 32
    +Mapped: 32,
    // 64
    +Instantiated: 64,
    // 128
    +ObjectLiteral: 128,
    // 256
    +EvolvingArray: 256,
    // 512
    +ObjectLiteralPatternWithComputedProperties: 512,
    // 1024
    +ContainsSpread: 1024,
    // 2048
    +ReverseMapped: 2048,
    // 4096
    +JsxAttributes: 4096,
    // 8192
    +MarkerType: 8192,
    // 16384
    +JSLiteral: 16384,
    // 32768
    +FreshLiteral: 32768,
    // 3
    +ClassOrInterface: 3,
    ...
  };

  declare type ObjectType = {
    ...$Exact<Type>,
    objectFlags: $Values<typeof ObjectFlags>,
    ...
  };

  declare type InterfaceType = {
    ...$Exact<ObjectType>,
    typeParameters: TypeParameter[] | void,
    outerTypeParameters: TypeParameter[] | void,
    localTypeParameters: TypeParameter[] | void,
    thisType: TypeParameter | void,
    ...
  };

  declare type BaseType = ObjectType | IntersectionType;
  declare type InterfaceTypeWithDeclaredMembers = {
    ...$Exact<InterfaceType>,
    declaredProperties: Symbol[],
    declaredCallSignatures: Signature[],
    declaredConstructSignatures: Signature[],
    declaredStringIndexInfo?: IndexInfo,
    declaredNumberIndexInfo?: IndexInfo,
    ...
  };

  declare type TypeReference = {
    ...$Exact<ObjectType>,
    target: GenericType,
    typeArguments?: $ReadOnlyArray<Type>,
    ...
  };

  declare type GenericType = {
    ...$Exact<InterfaceType>,
    ...$Exact<TypeReference>,
    ...
  };

  declare type TupleType = {
    ...$Exact<GenericType>,
    minLength: number,
    hasRestElement: boolean,
    associatedNames?: __String[],
    ...
  };

  declare type TupleTypeReference = {
    ...$Exact<TypeReference>,
    target: TupleType,
    ...
  };

  declare type UnionOrIntersectionType = {
    ...$Exact<Type>,
    types: Type[],
    ...
  };

  declare type UnionType = { ...$Exact<UnionOrIntersectionType>, ... };

  declare type IntersectionType = { ...$Exact<UnionOrIntersectionType>, ... };

  declare type StructuredType = ObjectType | UnionType | IntersectionType;
  declare type EvolvingArrayType = {
    ...$Exact<ObjectType>,
    elementType: Type,
    finalArrayType?: Type,
    ...
  };

  declare type InstantiableType = { ...$Exact<Type>, ... };

  declare type TypeParameter = { ...$Exact<InstantiableType>, ... };

  declare type IndexedAccessType = {
    ...$Exact<InstantiableType>,
    objectType: Type,
    indexType: Type,
    constraint?: Type,
    simplified?: Type,
    ...
  };

  declare type TypeVariable = TypeParameter | IndexedAccessType;
  declare type IndexType = {
    ...$Exact<InstantiableType>,
    type: InstantiableType | UnionOrIntersectionType,
    ...
  };

  declare type ConditionalRoot = {
    node: ConditionalTypeNode,
    checkType: Type,
    extendsType: Type,
    trueType: Type,
    falseType: Type,
    isDistributive: boolean,
    inferTypeParameters?: TypeParameter[],
    outerTypeParameters?: TypeParameter[],
    instantiations?: Map<Type>,
    aliasSymbol?: Symbol,
    aliasTypeArguments?: Type[],
    ...
  };

  declare type ConditionalType = {
    ...$Exact<InstantiableType>,
    root: ConditionalRoot,
    checkType: Type,
    extendsType: Type,
    resolvedTrueType?: Type,
    resolvedFalseType?: Type,
    ...
  };

  declare type SubstitutionType = {
    ...$Exact<InstantiableType>,
    typeVariable: TypeVariable,
    substitute: Type,
    ...
  };

  declare var SignatureKind: {
    // 0
    +Call: 0,
    // 1
    +Construct: 1,
    ...
  };

  declare type Signature = {
    declaration?: SignatureDeclaration | JSDocSignature,
    typeParameters?: $ReadOnlyArray<TypeParameter>,
    parameters: $ReadOnlyArray<Symbol>,
    getDeclaration(): SignatureDeclaration,
    getTypeParameters(): TypeParameter[] | void,
    getParameters(): Symbol[],
    getReturnType(): Type,
    getDocumentationComment(
      typeChecker: TypeChecker | void
    ): SymbolDisplayPart[],
    getJsDocTags(): JSDocTagInfo[],
    ...
  };

  declare var IndexKind: {
    // 0
    +String: 0,
    // 1
    +Number: 1,
    ...
  };

  declare type IndexInfo = {
    type: Type,
    isReadonly: boolean,
    declaration?: IndexSignatureDeclaration,
    ...
  };

  declare var InferencePriority: {
    // 1
    +NakedTypeVariable: 1,
    // 2
    +HomomorphicMappedType: 2,
    // 4
    +MappedTypeConstraint: 4,
    // 8
    +ReturnType: 8,
    // 16
    +LiteralKeyof: 16,
    // 32
    +NoConstraints: 32,
    // 64
    +AlwaysStrict: 64,
    // 28
    +PriorityImpliesCombination: 28,
    ...
  };

  declare type JsFileExtensionInfo = FileExtensionInfo;
  declare type FileExtensionInfo = {
    extension: string,
    isMixedContent: boolean,
    scriptKind?: $Values<typeof ScriptKind>,
    ...
  };

  declare type DiagnosticMessage = {
    key: string,
    category: $Values<typeof DiagnosticCategory>,
    code: number,
    message: string,
    reportsUnnecessary?: {...},
    ...
  };

  declare type DiagnosticMessageChain = {
    messageText: string,
    category: $Values<typeof DiagnosticCategory>,
    code: number,
    next?: DiagnosticMessageChain,
    ...
  };

  declare type Diagnostic = {
    ...$Exact<DiagnosticRelatedInformation>,
    reportsUnnecessary?: {...},
    source?: string,
    relatedInformation?: DiagnosticRelatedInformation[],
    ...
  };

  declare type DiagnosticRelatedInformation = {
    category: $Values<typeof DiagnosticCategory>,
    code: number,
    file: SourceFile | void,
    start: number | void,
    length: number | void,
    messageText: string | DiagnosticMessageChain,
    ...
  };

  declare type DiagnosticWithLocation = {
    ...$Exact<Diagnostic>,
    file: SourceFile,
    start: number,
    length: number,
    ...
  };

  declare var DiagnosticCategory: {
    // 0
    +Warning: 0,
    // 1
    +Error: 1,
    // 2
    +Suggestion: 2,
    // 3
    +Message: 3,
    ...
  };

  declare var ModuleResolutionKind: {
    // 1
    +Classic: 1,
    // 2
    +NodeJs: 2,
    ...
  };

  declare type PluginImport = { name: string, ... };

  declare type ProjectReference = {
    path: string,
    originalPath?: string,
    prepend?: boolean,
    circular?: boolean,
    ...
  };

  declare type CompilerOptionsValue =
    | string
    | number
    | boolean
    | (string | number)[]
    | string[]
    | MapLike<string[]>
    | PluginImport[]
    | ProjectReference[]
    | null
    | void;
  declare type CompilerOptions = {
    [option: string]: CompilerOptionsValue | TsConfigSourceFile | void,
    allowJs?: boolean,
    allowSyntheticDefaultImports?: boolean,
    allowUnreachableCode?: boolean,
    allowUnusedLabels?: boolean,
    alwaysStrict?: boolean,
    baseUrl?: string,
    charset?: string,
    checkJs?: boolean,
    declaration?: boolean,
    declarationMap?: boolean,
    emitDeclarationOnly?: boolean,
    declarationDir?: string,
    disableSizeLimit?: boolean,
    downlevelIteration?: boolean,
    emitBOM?: boolean,
    emitDecoratorMetadata?: boolean,
    experimentalDecorators?: boolean,
    forceConsistentCasingInFileNames?: boolean,
    importHelpers?: boolean,
    inlineSourceMap?: boolean,
    inlineSources?: boolean,
    isolatedModules?: boolean,
    jsx?: $Values<typeof JsxEmit>,
    keyofStringsOnly?: boolean,
    lib?: string[],
    locale?: string,
    mapRoot?: string,
    maxNodeModuleJsDepth?: number,
    module?: $Values<typeof ModuleKind>,
    moduleResolution?: $Values<typeof ModuleResolutionKind>,
    newLine?: $Values<typeof NewLineKind>,
    noEmit?: boolean,
    noEmitHelpers?: boolean,
    noEmitOnError?: boolean,
    noErrorTruncation?: boolean,
    noFallthroughCasesInSwitch?: boolean,
    noImplicitAny?: boolean,
    noImplicitReturns?: boolean,
    noImplicitThis?: boolean,
    noStrictGenericChecks?: boolean,
    noUnusedLocals?: boolean,
    noUnusedParameters?: boolean,
    noImplicitUseStrict?: boolean,
    noLib?: boolean,
    noResolve?: boolean,
    out?: string,
    outDir?: string,
    outFile?: string,
    paths?: MapLike<string[]>,
    preserveConstEnums?: boolean,
    preserveSymlinks?: boolean,
    project?: string,
    reactNamespace?: string,
    jsxFactory?: string,
    composite?: boolean,
    removeComments?: boolean,
    rootDir?: string,
    rootDirs?: string[],
    skipLibCheck?: boolean,
    skipDefaultLibCheck?: boolean,
    sourceMap?: boolean,
    sourceRoot?: string,
    strict?: boolean,
    strictFunctionTypes?: boolean,
    strictBindCallApply?: boolean,
    strictNullChecks?: boolean,
    strictPropertyInitialization?: boolean,
    stripInternal?: boolean,
    suppressExcessPropertyErrors?: boolean,
    suppressImplicitAnyIndexErrors?: boolean,
    target?: $Values<typeof ScriptTarget>,
    traceResolution?: boolean,
    resolveJsonModule?: boolean,
    types?: string[],
    typeRoots?: string[],
    esModuleInterop?: boolean,
    ...
  };

  declare type TypeAcquisition = {
    [option: string]: string[] | boolean | void,
    enableAutoDiscovery?: boolean,
    enable?: boolean,
    include?: string[],
    exclude?: string[],
    ...
  };

  declare var ModuleKind: {
    // 0
    +None: 0,
    // 1
    +CommonJS: 1,
    // 2
    +AMD: 2,
    // 3
    +UMD: 3,
    // 4
    +System: 4,
    // 5
    +ES2015: 5,
    // 6
    +ESNext: 6,
    ...
  };

  declare var JsxEmit: {
    // 0
    +None: 0,
    // 1
    +Preserve: 1,
    // 2
    +React: 2,
    // 3
    +ReactNative: 3,
    ...
  };

  declare var NewLineKind: {
    // 0
    +CarriageReturnLineFeed: 0,
    // 1
    +LineFeed: 1,
    ...
  };

  declare type LineAndCharacter = {
    line: number,
    character: number,
    ...
  };

  declare var ScriptKind: {
    // 0
    +Unknown: 0,
    // 1
    +JS: 1,
    // 2
    +JSX: 2,
    // 3
    +TS: 3,
    // 4
    +TSX: 4,
    // 5
    +External: 5,
    // 6
    +JSON: 6,
    // 7
    +Deferred: 7,
    ...
  };

  declare var ScriptTarget: {
    // 0
    +ES3: 0,
    // 1
    +ES5: 1,
    // 2
    +ES2015: 2,
    // 3
    +ES2016: 3,
    // 4
    +ES2017: 4,
    // 5
    +ES2018: 5,
    // 6
    +ESNext: 6,
    // 100
    +JSON: 100,
    // 6
    +Latest: 6,
    ...
  };

  declare var LanguageVariant: {
    // 0
    +Standard: 0,
    // 1
    +JSX: 1,
    ...
  };

  declare type ParsedCommandLine = {
    options: CompilerOptions,
    typeAcquisition?: TypeAcquisition,
    fileNames: string[],
    projectReferences?: $ReadOnlyArray<ProjectReference>,
    raw?: any,
    errors: Diagnostic[],
    wildcardDirectories?: MapLike<$Values<typeof WatchDirectoryFlags>>,
    compileOnSave?: boolean,
    ...
  };

  declare var WatchDirectoryFlags: {
    // 0
    +None: 0,
    // 1
    +Recursive: 1,
    ...
  };

  declare type ExpandResult = {
    fileNames: string[],
    wildcardDirectories: MapLike<$Values<typeof WatchDirectoryFlags>>,
    ...
  };

  declare type CreateProgramOptions = {
    rootNames: $ReadOnlyArray<string>,
    options: CompilerOptions,
    projectReferences?: $ReadOnlyArray<ProjectReference>,
    host?: CompilerHost,
    oldProgram?: Program,
    configFileParsingDiagnostics?: $ReadOnlyArray<Diagnostic>,
    ...
  };

  declare type ModuleResolutionHost = {
    fileExists(fileName: string): boolean,
    readFile(fileName: string): string | void,
    trace?: (s: string) => void,
    directoryExists?: (directoryName: string) => boolean,
    realpath?: (path: string) => string,
    getCurrentDirectory?: () => string,
    getDirectories?: (path: string) => string[],
    ...
  };

  declare type ResolvedModule = {
    resolvedFileName: string,
    isExternalLibraryImport?: boolean,
    ...
  };

  declare type ResolvedModuleFull = {
    ...$Exact<ResolvedModule>,
    extension: $Values<typeof Extension>,
    packageId?: PackageId,
    ...
  };

  declare type PackageId = {
    name: string,
    subModuleName: string,
    version: string,
    ...
  };

  declare var Extension: {
    // ".ts"
    +Ts: ".ts",
    // ".tsx"
    +Tsx: ".tsx",
    // ".d.ts"
    +Dts: ".d.ts",
    // ".js"
    +Js: ".js",
    // ".jsx"
    +Jsx: ".jsx",
    // ".json"
    +Json: ".json",
    ...
  };

  declare type ResolvedModuleWithFailedLookupLocations = { +resolvedModule: ResolvedModuleFull | void, ... };

  declare type ResolvedTypeReferenceDirective = {
    primary: boolean,
    resolvedFileName: string | void,
    packageId?: PackageId,
    isExternalLibraryImport?: boolean,
    ...
  };

  declare type ResolvedTypeReferenceDirectiveWithFailedLookupLocations = {
    +resolvedTypeReferenceDirective: ResolvedTypeReferenceDirective | void,
    +failedLookupLocations: $ReadOnlyArray<string>,
    ...
  };

  declare type CompilerHost = {
    ...$Exact<ModuleResolutionHost>,
    getSourceFile(
      fileName: string,
      languageVersion: $Values<typeof ScriptTarget>,
      onError?: (message: string) => void,
      shouldCreateNewSourceFile?: boolean
    ): SourceFile | void,
    getSourceFileByPath?: (
      fileName: string,
      path: Path,
      languageVersion: $Values<typeof ScriptTarget>,
      onError?: (message: string) => void,
      shouldCreateNewSourceFile?: boolean
    ) => SourceFile | void,
    getCancellationToken?: () => CancellationToken,
    getDefaultLibFileName(options: CompilerOptions): string,
    getDefaultLibLocation?: () => string,
    writeFile: WriteFileCallback,
    getCurrentDirectory(): string,
    getCanonicalFileName(fileName: string): string,
    useCaseSensitiveFileNames(): boolean,
    getNewLine(): string,
    readDirectory?: (
      rootDir: string,
      extensions: $ReadOnlyArray<string>,
      excludes: $ReadOnlyArray<string> | void,
      includes: $ReadOnlyArray<string>,
      depth?: number
    ) => string[],
    resolveModuleNames?: (
      moduleNames: string[],
      containingFile: string,
      reusedNames?: string[],
      redirectedReference?: ResolvedProjectReference
    ) => (ResolvedModule | void)[],
    resolveTypeReferenceDirectives?: (
      typeReferenceDirectiveNames: string[],
      containingFile: string,
      redirectedReference?: ResolvedProjectReference
    ) => (ResolvedTypeReferenceDirective | void)[],
    getEnvironmentVariable?: (name: string) => string | void,
    createHash?: (data: string) => string,
    ...
  };

  declare type SourceMapRange = {
    ...$Exact<TextRange>,
    source?: SourceMapSource,
    ...
  };

  declare type SourceMapSource = {
    fileName: string,
    text: string,
    skipTrivia?: (pos: number) => number,
    getLineAndCharacterOfPosition(pos: number): LineAndCharacter,
    ...
  };

  declare var EmitFlags: {
    // 0
    +None: 0,
    // 1
    +SingleLine: 1,
    // 2
    +AdviseOnEmitNode: 2,
    // 4
    +NoSubstitution: 4,
    // 8
    +CapturesThis: 8,
    // 16
    +NoLeadingSourceMap: 16,
    // 32
    +NoTrailingSourceMap: 32,
    // 48
    +NoSourceMap: 48,
    // 64
    +NoNestedSourceMaps: 64,
    // 128
    +NoTokenLeadingSourceMaps: 128,
    // 256
    +NoTokenTrailingSourceMaps: 256,
    // 384
    +NoTokenSourceMaps: 384,
    // 512
    +NoLeadingComments: 512,
    // 1024
    +NoTrailingComments: 1024,
    // 1536
    +NoComments: 1536,
    // 2048
    +NoNestedComments: 2048,
    // 4096
    +HelperName: 4096,
    // 8192
    +ExportName: 8192,
    // 16384
    +LocalName: 16384,
    // 32768
    +InternalName: 32768,
    // 65536
    +Indented: 65536,
    // 131072
    +NoIndentation: 131072,
    // 262144
    +AsyncFunctionBody: 262144,
    // 524288
    +ReuseTempVariableScope: 524288,
    // 1048576
    +CustomPrologue: 1048576,
    // 2097152
    +NoHoisting: 2097152,
    // 4194304
    +HasEndOfDeclarationMarker: 4194304,
    // 8388608
    +Iterator: 8388608,
    // 16777216
    +NoAsciiEscaping: 16777216,
    ...
  };

  declare type EmitHelper = {
    +name: string,
    +scoped: boolean,
    +text: string | ((node: EmitHelperUniqueNameCallback) => string),
    +priority?: number,
    ...
  };

  declare type EmitHelperUniqueNameCallback = (name: string) => string;

  declare var EmitHint: {
    // 0
    +SourceFile: 0,
    // 1
    +Expression: 1,
    // 2
    +IdentifierName: 2,
    // 3
    +MappedTypeParameter: 3,
    // 4
    +Unspecified: 4,
    // 5
    +EmbeddedStatement: 5,
    ...
  };

  declare type TransformationContext = {
    getCompilerOptions(): CompilerOptions,
    startLexicalEnvironment(): void,
    suspendLexicalEnvironment(): void,
    resumeLexicalEnvironment(): void,
    endLexicalEnvironment(): Statement[] | void,
    hoistFunctionDeclaration(node: FunctionDeclaration): void,
    hoistVariableDeclaration(node: Identifier): void,
    requestEmitHelper(helper: EmitHelper): void,
    readEmitHelpers(): EmitHelper[] | void,
    enableSubstitution(kind: $Values<typeof SyntaxKind>): void,
    isSubstitutionEnabled(node: Node): boolean,
    onSubstituteNode: (hint: $Values<typeof EmitHint>, node: Node) => Node,
    enableEmitNotification(kind: $Values<typeof SyntaxKind>): void,
    isEmitNotificationEnabled(node: Node): boolean,
    onEmitNode: (
      hint: $Values<typeof EmitHint>,
      node: Node,
      emitCallback: (hint: $Values<typeof EmitHint>, node: Node) => void
    ) => void,
    ...
  };

  declare type TransformationResult<T: Node> = {
    transformed: T[],
    diagnostics?: DiagnosticWithLocation[],
    substituteNode(hint: $Values<typeof EmitHint>, node: Node): Node,
    emitNodeWithNotification(
      hint: $Values<typeof EmitHint>,
      node: Node,
      emitCallback: (hint: $Values<typeof EmitHint>, node: Node) => void
    ): void,
    dispose(): void,
    ...
  };

  declare type TransformerFactory<T: Node> = (
    context: TransformationContext
  ) => Transformer<T>;
  declare type Transformer<T: Node> = (node: T) => T;
  declare type Visitor = (node: Node) => VisitResult<Node>;
  declare type VisitResult<T: Node> = T | T[] | void;
  declare type Printer = {
    printNode(
      hint: $Values<typeof EmitHint>,
      node: Node,
      sourceFile: SourceFile
    ): string,
    printList<T: Node>(
      format: $Values<typeof ListFormat>,
      list: NodeArray<T>,
      sourceFile: SourceFile
    ): string,
    printFile(sourceFile: SourceFile): string,
    printBundle(bundle: Bundle): string,
    ...
  };

  declare type PrintHandlers = {
    hasGlobalName?: (name: string) => boolean,
    onEmitNode?: (
      hint: $Values<typeof EmitHint>,
      node: Node | void,
      emitCallback: (hint: $Values<typeof EmitHint>, node: Node | void) => void
    ) => void,
    substituteNode?: (hint: $Values<typeof EmitHint>, node: Node) => Node,
    ...
  };

  declare type PrinterOptions = {
    removeComments?: boolean,
    newLine?: $Values<typeof NewLineKind>,
    omitTrailingSemicolon?: boolean,
    noEmitHelpers?: boolean,
    ...
  };

  declare type GetEffectiveTypeRootsHost = {
    directoryExists?: (directoryName: string) => boolean,
    getCurrentDirectory?: () => string,
    ...
  };

  declare type TextSpan = {
    start: number,
    length: number,
    ...
  };

  declare type TextChangeRange = {
    span: TextSpan,
    newLength: number,
    ...
  };

  declare type SyntaxList = {
    ...$Exact<Node>,
    _children: Node[],
    ...
  };

  declare var ListFormat: {
    // 0
    +None: 0,
    // 0
    +SingleLine: 0,
    // 1
    +MultiLine: 1,
    // 2
    +PreserveLines: 2,
    // 3
    +LinesMask: 3,
    // 0
    +NotDelimited: 0,
    // 4
    +BarDelimited: 4,
    // 8
    +AmpersandDelimited: 8,
    // 16
    +CommaDelimited: 16,
    // 32
    +AsteriskDelimited: 32,
    // 60
    +DelimitersMask: 60,
    // 64
    +AllowTrailingComma: 64,
    // 128
    +Indented: 128,
    // 256
    +SpaceBetweenBraces: 256,
    // 512
    +SpaceBetweenSiblings: 512,
    // 1024
    +Braces: 1024,
    // 2048
    +Parenthesis: 2048,
    // 4096
    +AngleBrackets: 4096,
    // 8192
    +SquareBrackets: 8192,
    // 15360
    +BracketsMask: 15360,
    // 16384
    +OptionalIfUndefined: 16384,
    // 32768
    +OptionalIfEmpty: 32768,
    // 49152
    +Optional: 49152,
    // 65536
    +PreferNewLine: 65536,
    // 131072
    +NoTrailingNewLine: 131072,
    // 262144
    +NoInterveningComments: 262144,
    // 524288
    +NoSpaceIfEmpty: 524288,
    // 1048576
    +SingleElement: 1048576,
    // 262656
    +Modifiers: 262656,
    // 512
    +HeritageClauses: 512,
    // 768
    +SingleLineTypeLiteralMembers: 768,
    // 32897
    +MultiLineTypeLiteralMembers: 32897,
    // 528
    +TupleTypeElements: 528,
    // 516
    +UnionTypeConstituents: 516,
    // 520
    +IntersectionTypeConstituents: 520,
    // 525136
    +ObjectBindingPatternElements: 525136,
    // 524880
    +ArrayBindingPatternElements: 524880,
    // 526226
    +ObjectLiteralExpressionProperties: 526226,
    // 8914
    +ArrayLiteralExpressionElements: 8914,
    // 528
    +CommaListElements: 528,
    // 2576
    +CallExpressionArguments: 2576,
    // 18960
    +NewExpressionArguments: 18960,
    // 262144
    +TemplateExpressionSpans: 262144,
    // 768
    +SingleLineBlockStatements: 768,
    // 129
    +MultiLineBlockStatements: 129,
    // 528
    +VariableDeclarationList: 528,
    // 768
    +SingleLineFunctionBodyStatements: 768,
    // 1
    +MultiLineFunctionBodyStatements: 1,
    // 0
    +ClassHeritageClauses: 0,
    // 129
    +ClassMembers: 129,
    // 129
    +InterfaceMembers: 129,
    // 145
    +EnumMembers: 145,
    // 129
    +CaseBlockClauses: 129,
    // 525136
    +NamedImportsOrExportsElements: 525136,
    // 262144
    +JsxElementOrFragmentChildren: 262144,
    // 262656
    +JsxElementAttributes: 262656,
    // 163969
    +CaseOrDefaultClauseStatements: 163969,
    // 528
    +HeritageClauseTypes: 528,
    // 131073
    +SourceFileStatements: 131073,
    // 49153
    +Decorators: 49153,
    // 53776
    +TypeArguments: 53776,
    // 53776
    +TypeParameters: 53776,
    // 2576
    +Parameters: 2576,
    // 8848
    +IndexSignatureParameters: 8848,
    // 33
    +JSDocComment: 33,
    ...
  };

  declare type UserPreferences = {
    +disableSuggestions?: boolean,
    +quotePreference?: "auto" | "double" | "single",
    +includeCompletionsForModuleExports?: boolean,
    +includeCompletionsWithInsertText?: boolean,
    +importModuleSpecifierPreference?: "relative" | "non-relative",
    +importModuleSpecifierEnding?: "minimal" | "index" | "js",
    +allowTextChangesInNewFiles?: boolean,
    +providePrefixAndSuffixTextForRename?: boolean,
    ...
  };

  declare type PseudoBigInt = {
    negative: boolean,
    base10Value: string,
    ...
  };

  declare var FileWatcherEventKind: {
    // 0
    +Created: 0,
    // 1
    +Changed: 1,
    // 2
    +Deleted: 2,
    ...
  };

  declare type FileWatcherCallback = (
    fileName: string,
    eventKind: $Values<typeof FileWatcherEventKind>
  ) => void;
  declare type DirectoryWatcherCallback = (fileName: string) => void;
  declare type System = {
    args: string[],
    newLine: string,
    useCaseSensitiveFileNames: boolean,
    write(s: string): void,
    writeOutputIsTTY?: () => boolean,
    readFile(path: string, encoding?: string): string | void,
    getFileSize?: (path: string) => number,
    writeFile(path: string, data: string, writeByteOrderMark?: boolean): void,
    watchFile?: (
      path: string,
      callback: FileWatcherCallback,
      pollingInterval?: number
    ) => FileWatcher,
    watchDirectory?: (
      path: string,
      callback: DirectoryWatcherCallback,
      recursive?: boolean
    ) => FileWatcher,
    resolvePath(path: string): string,
    fileExists(path: string): boolean,
    directoryExists(path: string): boolean,
    createDirectory(path: string): void,
    getExecutingFilePath(): string,
    getCurrentDirectory(): string,
    getDirectories(path: string): string[],
    readDirectory(
      path: string,
      extensions?: $ReadOnlyArray<string>,
      exclude?: $ReadOnlyArray<string>,
      include?: $ReadOnlyArray<string>,
      depth?: number
    ): string[],
    getModifiedTime?: (path: string) => Date | void,
    setModifiedTime?: (path: string, time: Date) => void,
    deleteFile?: (path: string) => void,
    createHash?: (data: string) => string,
    createSHA256Hash?: (data: string) => string,
    getMemoryUsage?: () => number,
    exit(exitCode?: number): void,
    realpath?: (path: string) => string,
    setTimeout?: (
      callback: (...args: any[]) => void,
      ms: number,
      ...args: any[]
    ) => any,
    clearTimeout?: (timeoutId: any) => void,
    clearScreen?: () => void,
    base64decode?: (input: string) => string,
    base64encode?: (input: string) => string,
    ...
  };

  declare type FileWatcher = { close(): void, ... };

  declare function getNodeMajorVersion(): number | void;

  declare var sys: System;
  declare type ErrorCallback = (
    message: DiagnosticMessage,
    length: number
  ) => void;
  declare type Scanner = {
    getStartPos(): number,
    getToken(): $Values<typeof SyntaxKind>,
    getTextPos(): number,
    getTokenPos(): number,
    getTokenText(): string,
    getTokenValue(): string,
    hasExtendedUnicodeEscape(): boolean,
    hasPrecedingLineBreak(): boolean,
    isIdentifier(): boolean,
    isReservedWord(): boolean,
    isUnterminated(): boolean,
    reScanGreaterToken(): $Values<typeof SyntaxKind>,
    reScanSlashToken(): $Values<typeof SyntaxKind>,
    reScanTemplateToken(): $Values<typeof SyntaxKind>,
    scanJsxIdentifier(): $Values<typeof SyntaxKind>,
    scanJsxAttributeValue(): $Values<typeof SyntaxKind>,
    reScanJsxToken(): JsxTokenSyntaxKind,
    reScanLessThanToken(): $Values<typeof SyntaxKind>,
    scanJsxToken(): JsxTokenSyntaxKind,
    scanJSDocToken(): JsDocSyntaxKind,
    scan(): $Values<typeof SyntaxKind>,
    getText(): string,
    setText(text: string | void, start?: number, length?: number): void,
    setOnError(onError: ErrorCallback | void): void,
    setScriptTarget(scriptTarget: $Values<typeof ScriptTarget>): void,
    setLanguageVariant(variant: $Values<typeof LanguageVariant>): void,
    setTextPos(textPos: number): void,
    lookAhead<T>(callback: () => T): T,
    scanRange<T>(start: number, length: number, callback: () => T): T,
    tryScan<T>(callback: () => T): T,
    ...
  };

  declare function tokenToString(t: $Values<typeof SyntaxKind>): string | void;

  declare function getPositionOfLineAndCharacter(
    sourceFile: SourceFileLike,
    line: number,
    character: number
  ): number;

  declare function getLineAndCharacterOfPosition(
    sourceFile: SourceFileLike,
    position: number
  ): LineAndCharacter;

  declare function isWhiteSpaceLike(ch: number): boolean;

  declare function isWhiteSpaceSingleLine(ch: number): boolean;

  declare function isLineBreak(ch: number): boolean;

  declare function couldStartTrivia(text: string, pos: number): boolean;

  declare function forEachLeadingCommentRange<U>(
    text: string,
    pos: number,
    cb: (
      pos: number,
      end: number,
      kind: CommentKind,
      hasTrailingNewLine: boolean
    ) => U
  ): U | void;

  declare function forEachLeadingCommentRange<T, U>(
    text: string,
    pos: number,
    cb: (
      pos: number,
      end: number,
      kind: CommentKind,
      hasTrailingNewLine: boolean,
      state: T
    ) => U,
    state: T
  ): U | void;

  declare function forEachTrailingCommentRange<U>(
    text: string,
    pos: number,
    cb: (
      pos: number,
      end: number,
      kind: CommentKind,
      hasTrailingNewLine: boolean
    ) => U
  ): U | void;

  declare function forEachTrailingCommentRange<T, U>(
    text: string,
    pos: number,
    cb: (
      pos: number,
      end: number,
      kind: CommentKind,
      hasTrailingNewLine: boolean,
      state: T
    ) => U,
    state: T
  ): U | void;

  declare function reduceEachLeadingCommentRange<T, U>(
    text: string,
    pos: number,
    cb: (
      pos: number,
      end: number,
      kind: CommentKind,
      hasTrailingNewLine: boolean,
      state: T,
      memo: U
    ) => U,
    state: T,
    initial: U
  ): U | void;

  declare function reduceEachTrailingCommentRange<T, U>(
    text: string,
    pos: number,
    cb: (
      pos: number,
      end: number,
      kind: CommentKind,
      hasTrailingNewLine: boolean,
      state: T,
      memo: U
    ) => U,
    state: T,
    initial: U
  ): U | void;

  declare function getLeadingCommentRanges(
    text: string,
    pos: number
  ): CommentRange[] | void;

  declare function getTrailingCommentRanges(
    text: string,
    pos: number
  ): CommentRange[] | void;

  declare function getShebang(text: string): string | void;

  declare function isIdentifierStart(
    ch: number,
    languageVersion: $Values<typeof ScriptTarget> | void
  ): boolean;

  declare function isIdentifierPart(
    ch: number,
    languageVersion: $Values<typeof ScriptTarget> | void
  ): boolean;

  declare function createScanner(
    languageVersion: $Values<typeof ScriptTarget>,
    skipTrivia: boolean,
    languageVariant?: $Values<typeof LanguageVariant>,
    textInitial?: string,
    onError?: ErrorCallback,
    start?: number,
    length?: number
  ): Scanner;

  declare function isExternalModuleNameRelative(moduleName: string): boolean;

  declare function sortAndDeduplicateDiagnostics<T: Diagnostic>(
    diagnostics: $ReadOnlyArray<T>
  ): SortedReadonlyArray<T>;

  declare function getDefaultLibFileName(options: CompilerOptions): string;

  declare function textSpanEnd(span: TextSpan): number;

  declare function textSpanIsEmpty(span: TextSpan): boolean;

  declare function textSpanContainsPosition(
    span: TextSpan,
    position: number
  ): boolean;

  declare function textSpanContainsTextSpan(
    span: TextSpan,
    other: TextSpan
  ): boolean;

  declare function textSpanOverlapsWith(
    span: TextSpan,
    other: TextSpan
  ): boolean;

  declare function textSpanOverlap(
    span1: TextSpan,
    span2: TextSpan
  ): TextSpan | void;

  declare function textSpanIntersectsWithTextSpan(
    span: TextSpan,
    other: TextSpan
  ): boolean;

  declare function textSpanIntersectsWith(
    span: TextSpan,
    start: number,
    length: number
  ): boolean;

  declare function decodedTextSpanIntersectsWith(
    start1: number,
    length1: number,
    start2: number,
    length2: number
  ): boolean;

  declare function textSpanIntersectsWithPosition(
    span: TextSpan,
    position: number
  ): boolean;

  declare function textSpanIntersection(
    span1: TextSpan,
    span2: TextSpan
  ): TextSpan | void;

  declare function createTextSpan(start: number, length: number): TextSpan;

  declare function createTextSpanFromBounds(
    start: number,
    end: number
  ): TextSpan;

  declare function textChangeRangeNewSpan(range: TextChangeRange): TextSpan;

  declare function textChangeRangeIsUnchanged(range: TextChangeRange): boolean;

  declare function createTextChangeRange(
    span: TextSpan,
    newLength: number
  ): TextChangeRange;

  declare var unchangedTextChangeRange: TextChangeRange;
  declare function collapseTextChangeRangesAcrossMultipleVersions(
    changes: $ReadOnlyArray<TextChangeRange>
  ): TextChangeRange;

  declare function getTypeParameterOwner(d: Declaration): Declaration | void;

  declare type ParameterPropertyDeclaration = ParameterDeclaration & {
    parent: ConstructorDeclaration,
    name: Identifier,
    ...
  };
  declare function isParameterPropertyDeclaration(node: Node): boolean;

  declare function isEmptyBindingPattern(node: BindingName): boolean;

  declare function isEmptyBindingElement(node: BindingElement): boolean;

  declare function walkUpBindingElementsAndPatterns(
    binding: BindingElement
  ): VariableDeclaration | ParameterDeclaration;

  declare function getCombinedModifierFlags(
    node: Declaration
  ): $Values<typeof ModifierFlags>;

  declare function getCombinedNodeFlags(node: Node): $Values<typeof NodeFlags>;

  declare function validateLocaleAndSetLanguage(
    locale: string,
    sys: {
      getExecutingFilePath(): string,
      resolvePath(path: string): string,
      fileExists(fileName: string): boolean,
      readFile(fileName: string): string | void,
      ...
    },
    errors?: Push<Diagnostic>
  ): void;

  declare function getOriginalNode(node: Node): Node;

  declare function getOriginalNode<T: Node>(
    node: Node,
    nodeTest: (node: Node) => boolean
  ): T;

  declare function getOriginalNode(node: Node | void): Node | void;

  declare function getOriginalNode<T: Node>(
    node: Node | void,
    nodeTest: (node: Node | void) => boolean
  ): T | void;

  declare function isParseTreeNode(node: Node): boolean;

  declare function getParseTreeNode(node: Node): Node;

  declare function getParseTreeNode<T: Node>(
    node: Node | void,
    nodeTest?: (node: Node) => boolean
  ): T | void;

  declare function escapeLeadingUnderscores(identifier: string): __String;

  declare function unescapeLeadingUnderscores(identifier: __String): string;

  declare function idText(identifier: Identifier): string;

  declare function symbolName(symbol: Symbol): string;

  declare function getNameOfJSDocTypedef(
    declaration: JSDocTypedefTag
  ): Identifier | void;

  declare function getNameOfDeclaration(
    declaration: Declaration | Expression
  ): DeclarationName | void;

  declare function getJSDocParameterTags(
    param: ParameterDeclaration
  ): $ReadOnlyArray<JSDocParameterTag>;

  declare function getJSDocTypeParameterTags(
    param: TypeParameterDeclaration
  ): $ReadOnlyArray<JSDocTemplateTag>;

  declare function hasJSDocParameterTags(
    node: FunctionLikeDeclaration | SignatureDeclaration
  ): boolean;

  declare function getJSDocAugmentsTag(node: Node): JSDocAugmentsTag | void;

  declare function getJSDocClassTag(node: Node): JSDocClassTag | void;

  declare function getJSDocEnumTag(node: Node): JSDocEnumTag | void;

  declare function getJSDocThisTag(node: Node): JSDocThisTag | void;

  declare function getJSDocReturnTag(node: Node): JSDocReturnTag | void;

  declare function getJSDocTemplateTag(node: Node): JSDocTemplateTag | void;

  declare function getJSDocTypeTag(node: Node): JSDocTypeTag | void;

  declare function getJSDocType(node: Node): TypeNode | void;

  declare function getJSDocReturnType(node: Node): TypeNode | void;

  declare function getJSDocTags(node: Node): $ReadOnlyArray<JSDocTag>;

  declare function getAllJSDocTagsOfKind(
    node: Node,
    kind: $Values<typeof SyntaxKind>
  ): $ReadOnlyArray<JSDocTag>;

  declare function getEffectiveTypeParameterDeclarations(
    node: DeclarationWithTypeParameters
  ): $ReadOnlyArray<TypeParameterDeclaration>;

  declare function getEffectiveConstraintOfTypeParameter(
    node: TypeParameterDeclaration
  ): TypeNode | void;

  declare function isNumericLiteral(node: Node): boolean;

  declare function isBigIntLiteral(node: Node): boolean;

  declare function isStringLiteral(node: Node): boolean;

  declare function isJsxText(node: Node): boolean;

  declare function isRegularExpressionLiteral(node: Node): boolean;

  declare function isNoSubstitutionTemplateLiteral(node: Node): boolean;

  declare function isTemplateHead(node: Node): boolean;

  declare function isTemplateMiddle(node: Node): boolean;

  declare function isTemplateTail(node: Node): boolean;

  declare function isIdentifier(node: Node): boolean;

  declare function isQualifiedName(node: Node): boolean;

  declare function isComputedPropertyName(node: Node): boolean;

  declare function isTypeParameterDeclaration(node: Node): boolean;

  declare function isParameter(node: Node): boolean;

  declare function isDecorator(node: Node): boolean;

  declare function isPropertySignature(node: Node): boolean;

  declare function isPropertyDeclaration(node: Node): boolean;

  declare function isMethodSignature(node: Node): boolean;

  declare function isMethodDeclaration(node: Node): boolean;

  declare function isConstructorDeclaration(node: Node): boolean;

  declare function isGetAccessorDeclaration(node: Node): boolean;

  declare function isSetAccessorDeclaration(node: Node): boolean;

  declare function isCallSignatureDeclaration(node: Node): boolean;

  declare function isConstructSignatureDeclaration(node: Node): boolean;

  declare function isIndexSignatureDeclaration(node: Node): boolean;

  declare function isTypePredicateNode(node: Node): boolean;

  declare function isTypeReferenceNode(node: Node): boolean;

  declare function isFunctionTypeNode(node: Node): boolean;

  declare function isConstructorTypeNode(node: Node): boolean;

  declare function isTypeQueryNode(node: Node): boolean;

  declare function isTypeLiteralNode(node: Node): boolean;

  declare function isArrayTypeNode(node: Node): boolean;

  declare function isTupleTypeNode(node: Node): boolean;

  declare function isUnionTypeNode(node: Node): boolean;

  declare function isIntersectionTypeNode(node: Node): boolean;

  declare function isConditionalTypeNode(node: Node): boolean;

  declare function isInferTypeNode(node: Node): boolean;

  declare function isParenthesizedTypeNode(node: Node): boolean;

  declare function isThisTypeNode(node: Node): boolean;

  declare function isTypeOperatorNode(node: Node): boolean;

  declare function isIndexedAccessTypeNode(node: Node): boolean;

  declare function isMappedTypeNode(node: Node): boolean;

  declare function isLiteralTypeNode(node: Node): boolean;

  declare function isImportTypeNode(node: Node): boolean;

  declare function isObjectBindingPattern(node: Node): boolean;

  declare function isArrayBindingPattern(node: Node): boolean;

  declare function isBindingElement(node: Node): boolean;

  declare function isArrayLiteralExpression(node: Node): boolean;

  declare function isObjectLiteralExpression(node: Node): boolean;

  declare function isPropertyAccessExpression(node: Node): boolean;

  declare function isElementAccessExpression(node: Node): boolean;

  declare function isCallExpression(node: Node): boolean;

  declare function isNewExpression(node: Node): boolean;

  declare function isTaggedTemplateExpression(node: Node): boolean;

  declare function isTypeAssertion(node: Node): boolean;

  declare function isParenthesizedExpression(node: Node): boolean;

  declare function skipPartiallyEmittedExpressions(
    node: Expression
  ): Expression;

  declare function skipPartiallyEmittedExpressions(node: Node): Node;

  declare function isFunctionExpression(node: Node): boolean;

  declare function isArrowFunction(node: Node): boolean;

  declare function isDeleteExpression(node: Node): boolean;

  declare function isTypeOfExpression(node: Node): boolean;

  declare function isVoidExpression(node: Node): boolean;

  declare function isAwaitExpression(node: Node): boolean;

  declare function isPrefixUnaryExpression(node: Node): boolean;

  declare function isPostfixUnaryExpression(node: Node): boolean;

  declare function isBinaryExpression(node: Node): boolean;

  declare function isConditionalExpression(node: Node): boolean;

  declare function isTemplateExpression(node: Node): boolean;

  declare function isYieldExpression(node: Node): boolean;

  declare function isSpreadElement(node: Node): boolean;

  declare function isClassExpression(node: Node): boolean;

  declare function isOmittedExpression(node: Node): boolean;

  declare function isExpressionWithTypeArguments(node: Node): boolean;

  declare function isAsExpression(node: Node): boolean;

  declare function isNonNullExpression(node: Node): boolean;

  declare function isMetaProperty(node: Node): boolean;

  declare function isTemplateSpan(node: Node): boolean;

  declare function isSemicolonClassElement(node: Node): boolean;

  declare function isBlock(node: Node): boolean;

  declare function isVariableStatement(node: Node): boolean;

  declare function isEmptyStatement(node: Node): boolean;

  declare function isExpressionStatement(node: Node): boolean;

  declare function isIfStatement(node: Node): boolean;

  declare function isDoStatement(node: Node): boolean;

  declare function isWhileStatement(node: Node): boolean;

  declare function isForStatement(node: Node): boolean;

  declare function isForInStatement(node: Node): boolean;

  declare function isForOfStatement(node: Node): boolean;

  declare function isContinueStatement(node: Node): boolean;

  declare function isBreakStatement(node: Node): boolean;

  declare function isBreakOrContinueStatement(node: Node): boolean;

  declare function isReturnStatement(node: Node): boolean;

  declare function isWithStatement(node: Node): boolean;

  declare function isSwitchStatement(node: Node): boolean;

  declare function isLabeledStatement(node: Node): boolean;

  declare function isThrowStatement(node: Node): boolean;

  declare function isTryStatement(node: Node): boolean;

  declare function isDebuggerStatement(node: Node): boolean;

  declare function isVariableDeclaration(node: Node): boolean;

  declare function isVariableDeclarationList(node: Node): boolean;

  declare function isFunctionDeclaration(node: Node): boolean;

  declare function isClassDeclaration(node: Node): boolean;

  declare function isInterfaceDeclaration(node: Node): boolean;

  declare function isTypeAliasDeclaration(node: Node): boolean;

  declare function isEnumDeclaration(node: Node): boolean;

  declare function isModuleDeclaration(node: Node): boolean;

  declare function isModuleBlock(node: Node): boolean;

  declare function isCaseBlock(node: Node): boolean;

  declare function isNamespaceExportDeclaration(node: Node): boolean;

  declare function isImportEqualsDeclaration(node: Node): boolean;

  declare function isImportDeclaration(node: Node): boolean;

  declare function isImportClause(node: Node): boolean;

  declare function isNamespaceImport(node: Node): boolean;

  declare function isNamedImports(node: Node): boolean;

  declare function isImportSpecifier(node: Node): boolean;

  declare function isExportAssignment(node: Node): boolean;

  declare function isExportDeclaration(node: Node): boolean;

  declare function isNamedExports(node: Node): boolean;

  declare function isExportSpecifier(node: Node): boolean;

  declare function isMissingDeclaration(node: Node): boolean;

  declare function isExternalModuleReference(node: Node): boolean;

  declare function isJsxElement(node: Node): boolean;

  declare function isJsxSelfClosingElement(node: Node): boolean;

  declare function isJsxOpeningElement(node: Node): boolean;

  declare function isJsxClosingElement(node: Node): boolean;

  declare function isJsxFragment(node: Node): boolean;

  declare function isJsxOpeningFragment(node: Node): boolean;

  declare function isJsxClosingFragment(node: Node): boolean;

  declare function isJsxAttribute(node: Node): boolean;

  declare function isJsxAttributes(node: Node): boolean;

  declare function isJsxSpreadAttribute(node: Node): boolean;

  declare function isJsxExpression(node: Node): boolean;

  declare function isCaseClause(node: Node): boolean;

  declare function isDefaultClause(node: Node): boolean;

  declare function isHeritageClause(node: Node): boolean;

  declare function isCatchClause(node: Node): boolean;

  declare function isPropertyAssignment(node: Node): boolean;

  declare function isShorthandPropertyAssignment(node: Node): boolean;

  declare function isSpreadAssignment(node: Node): boolean;

  declare function isEnumMember(node: Node): boolean;

  declare function isSourceFile(node: Node): boolean;

  declare function isBundle(node: Node): boolean;

  declare function isUnparsedSource(node: Node): boolean;

  declare function isJSDocTypeExpression(node: Node): boolean;

  declare function isJSDocAllType(node: JSDocAllType): boolean;

  declare function isJSDocUnknownType(node: Node): boolean;

  declare function isJSDocNullableType(node: Node): boolean;

  declare function isJSDocNonNullableType(node: Node): boolean;

  declare function isJSDocOptionalType(node: Node): boolean;

  declare function isJSDocFunctionType(node: Node): boolean;

  declare function isJSDocVariadicType(node: Node): boolean;

  declare function isJSDoc(node: Node): boolean;

  declare function isJSDocAugmentsTag(node: Node): boolean;

  declare function isJSDocClassTag(node: Node): boolean;

  declare function isJSDocEnumTag(node: Node): boolean;

  declare function isJSDocThisTag(node: Node): boolean;

  declare function isJSDocParameterTag(node: Node): boolean;

  declare function isJSDocReturnTag(node: Node): boolean;

  declare function isJSDocTypeTag(node: Node): boolean;

  declare function isJSDocTemplateTag(node: Node): boolean;

  declare function isJSDocTypedefTag(node: Node): boolean;

  declare function isJSDocPropertyTag(node: Node): boolean;

  declare function isJSDocPropertyLikeTag(node: Node): boolean;

  declare function isJSDocTypeLiteral(node: Node): boolean;

  declare function isJSDocCallbackTag(node: Node): boolean;

  declare function isJSDocSignature(node: Node): boolean;

  declare function isToken(n: Node): boolean;

  declare function isLiteralExpression(node: Node): boolean;

  declare type TemplateLiteralToken =
    | NoSubstitutionTemplateLiteral
    | TemplateHead
    | TemplateMiddle
    | TemplateTail;
  declare function isTemplateLiteralToken(node: Node): boolean;

  declare function isTemplateMiddleOrTemplateTail(node: Node): boolean;

  declare function isImportOrExportSpecifier(node: Node): boolean;

  declare function isStringTextContainingNode(node: Node): boolean;

  declare function isModifier(node: Node): boolean;

  declare function isEntityName(node: Node): boolean;

  declare function isPropertyName(node: Node): boolean;

  declare function isBindingName(node: Node): boolean;

  declare function isFunctionLike(node: Node): boolean;

  declare function isClassElement(node: Node): boolean;

  declare function isClassLike(node: Node): boolean;

  declare function isAccessor(node: Node): boolean;

  declare function isTypeElement(node: Node): boolean;

  declare function isClassOrTypeElement(node: Node): boolean;

  declare function isObjectLiteralElementLike(node: Node): boolean;

  declare function isTypeNode(node: Node): boolean;

  declare function isFunctionOrConstructorTypeNode(node: Node): boolean;

  declare function isPropertyAccessOrQualifiedName(node: Node): boolean;

  declare function isCallLikeExpression(node: Node): boolean;

  declare function isCallOrNewExpression(node: Node): boolean;

  declare function isTemplateLiteral(node: Node): boolean;

  declare function isAssertionExpression(node: Node): boolean;

  declare function isIterationStatement(
    node: Node,
    lookInLabeledStatements: false
  ): boolean;

  declare function isIterationStatement(
    node: Node,
    lookInLabeledStatements: boolean
  ): boolean;

  declare function isJsxOpeningLikeElement(node: Node): boolean;

  declare function isCaseOrDefaultClause(node: Node): boolean;

  declare function isJSDocCommentContainingNode(node: Node): boolean;

  declare function isSetAccessor(node: Node): boolean;

  declare function isGetAccessor(node: Node): boolean;

  declare function isObjectLiteralElement(node: Node): boolean;

  declare function isStringLiteralLike(node: Node): boolean;

  declare function createNode(
    kind: $Values<typeof SyntaxKind>,
    pos?: number,
    end?: number
  ): Node;

  declare function forEachChild<T>(
    node: Node,
    cbNode: (node: Node) => T | void,
    cbNodes?: (nodes: NodeArray<Node>) => T | void
  ): T | void;

  declare function createSourceFile(
    fileName: string,
    sourceText: string,
    languageVersion: $Values<typeof ScriptTarget>,
    setParentNodes?: boolean,
    scriptKind?: $Values<typeof ScriptKind>
  ): SourceFile;

  declare function parseIsolatedEntityName(
    text: string,
    languageVersion: $Values<typeof ScriptTarget>
  ): EntityName | void;

  declare function parseJsonText(
    fileName: string,
    sourceText: string
  ): JsonSourceFile;

  declare function isExternalModule(file: SourceFile): boolean;

  declare function updateSourceFile(
    sourceFile: SourceFile,
    newText: string,
    textChangeRange: TextChangeRange,
    aggressiveChecks?: boolean
  ): SourceFile;

  declare function parseCommandLine(
    commandLine: $ReadOnlyArray<string>,
    readFile?: (path: string) => string | void
  ): ParsedCommandLine;

  declare type DiagnosticReporter = (diagnostic: Diagnostic) => void;
  declare type ConfigFileDiagnosticsReporter = { onUnRecoverableConfigFileDiagnostic: DiagnosticReporter, ... };

  declare type ParseConfigFileHost = {
    ...$Exact<ParseConfigHost>,
    ...$Exact<ConfigFileDiagnosticsReporter>,
    getCurrentDirectory(): string,
    ...
  };

  declare function getParsedCommandLineOfConfigFile(
    configFileName: string,
    optionsToExtend: CompilerOptions,
    host: ParseConfigFileHost
  ): ParsedCommandLine | void;

  declare function readConfigFile(
    fileName: string,
    readFile: (path: string) => string | void
  ): {
    config?: any,
    error?: Diagnostic,
    ...
  };

  declare function parseConfigFileTextToJson(
    fileName: string,
    jsonText: string
  ): {
    config?: any,
    error?: Diagnostic,
    ...
  };

  declare function readJsonConfigFile(
    fileName: string,
    readFile: (path: string) => string | void
  ): TsConfigSourceFile;

  declare function convertToObject(
    sourceFile: JsonSourceFile,
    errors: Push<Diagnostic>
  ): any;

  declare function parseJsonConfigFileContent(
    json: any,
    host: ParseConfigHost,
    basePath: string,
    existingOptions?: CompilerOptions,
    configFileName?: string,
    resolutionStack?: Path[],
    extraFileExtensions?: $ReadOnlyArray<FileExtensionInfo>
  ): ParsedCommandLine;

  declare function parseJsonSourceFileConfigFileContent(
    sourceFile: TsConfigSourceFile,
    host: ParseConfigHost,
    basePath: string,
    existingOptions?: CompilerOptions,
    configFileName?: string,
    resolutionStack?: Path[],
    extraFileExtensions?: $ReadOnlyArray<FileExtensionInfo>
  ): ParsedCommandLine;

  declare function convertCompilerOptionsFromJson(
    jsonOptions: any,
    basePath: string,
    configFileName?: string
  ): {
    options: CompilerOptions,
    errors: Diagnostic[],
    ...
  };

  declare function convertTypeAcquisitionFromJson(
    jsonOptions: any,
    basePath: string,
    configFileName?: string
  ): {
    options: TypeAcquisition,
    errors: Diagnostic[],
    ...
  };

  declare function getEffectiveTypeRoots(
    options: CompilerOptions,
    host: GetEffectiveTypeRootsHost
  ): string[] | void;

  declare function resolveTypeReferenceDirective(
    typeReferenceDirectiveName: string,
    containingFile: string | void,
    options: CompilerOptions,
    host: ModuleResolutionHost,
    redirectedReference?: ResolvedProjectReference
  ): ResolvedTypeReferenceDirectiveWithFailedLookupLocations;

  declare function getAutomaticTypeDirectiveNames(
    options: CompilerOptions,
    host: ModuleResolutionHost
  ): string[];

  declare type ModuleResolutionCache = {
    ...$Exact<NonRelativeModuleNameResolutionCache>,
    getOrCreateCacheForDirectory(
      directoryName: string,
      redirectedReference?: ResolvedProjectReference
    ): Map<ResolvedModuleWithFailedLookupLocations>,
    ...
  };

  declare type NonRelativeModuleNameResolutionCache = { getOrCreateCacheForModuleName(
    nonRelativeModuleName: string,
    redirectedReference?: ResolvedProjectReference
  ): PerModuleNameCache, ... };

  declare type PerModuleNameCache = {
    get(directory: string): ResolvedModuleWithFailedLookupLocations | void,
    set(
      directory: string,
      result: ResolvedModuleWithFailedLookupLocations
    ): void,
    ...
  };

  declare function createModuleResolutionCache(
    currentDirectory: string,
    getCanonicalFileName: (s: string) => string
  ): ModuleResolutionCache;

  declare function resolveModuleNameFromCache(
    moduleName: string,
    containingFile: string,
    cache: ModuleResolutionCache
  ): ResolvedModuleWithFailedLookupLocations | void;

  declare function resolveModuleName(
    moduleName: string,
    containingFile: string,
    compilerOptions: CompilerOptions,
    host: ModuleResolutionHost,
    cache?: ModuleResolutionCache,
    redirectedReference?: ResolvedProjectReference
  ): ResolvedModuleWithFailedLookupLocations;

  declare function nodeModuleNameResolver(
    moduleName: string,
    containingFile: string,
    compilerOptions: CompilerOptions,
    host: ModuleResolutionHost,
    cache?: ModuleResolutionCache,
    redirectedReference?: ResolvedProjectReference
  ): ResolvedModuleWithFailedLookupLocations;

  declare function classicNameResolver(
    moduleName: string,
    containingFile: string,
    compilerOptions: CompilerOptions,
    host: ModuleResolutionHost,
    cache?: NonRelativeModuleNameResolutionCache,
    redirectedReference?: ResolvedProjectReference
  ): ResolvedModuleWithFailedLookupLocations;

  declare function createNodeArray<T: Node>(
    elements?: $ReadOnlyArray<T>,
    hasTrailingComma?: boolean
  ): NodeArray<T>;

  declare function createLiteral(
    value:
      | string
      | StringLiteral
      | NoSubstitutionTemplateLiteral
      | NumericLiteral
      | Identifier
  ): StringLiteral;

  declare function createLiteral(value: number | PseudoBigInt): NumericLiteral;

  declare function createLiteral(value: boolean): BooleanLiteral;

  declare function createLiteral(
    value: string | number | PseudoBigInt | boolean
  ): PrimaryExpression;

  declare function createNumericLiteral(value: string): NumericLiteral;

  declare function createBigIntLiteral(value: string): BigIntLiteral;

  declare function createStringLiteral(text: string): StringLiteral;

  declare function createRegularExpressionLiteral(
    text: string
  ): RegularExpressionLiteral;

  declare function createIdentifier(text: string): Identifier;

  declare function updateIdentifier(node: Identifier): Identifier;

  declare function createTempVariable(
    recordTempVariable: ((node: Identifier) => void) | void
  ): Identifier;

  declare function createLoopVariable(): Identifier;

  declare function createUniqueName(text: string): Identifier;

  declare function createOptimisticUniqueName(text: string): Identifier;

  declare function createFileLevelUniqueName(text: string): Identifier;

  declare function getGeneratedNameForNode(node: Node | void): Identifier;

  declare function createToken<TKind: $Values<typeof SyntaxKind>>(
    token: TKind
  ): Token<TKind>;

  declare function createSuper(): SuperExpression;

  declare function createThis(): ThisExpression &
    Token<typeof SyntaxKind.ThisKeyword>;

  declare function createNull(): NullLiteral &
    Token<typeof SyntaxKind.NullKeyword>;

  declare function createTrue(): BooleanLiteral &
    Token<typeof SyntaxKind.TrueKeyword>;

  declare function createFalse(): BooleanLiteral &
    Token<typeof SyntaxKind.FalseKeyword>;

  declare function createModifier<T: $ElementType<Modifier, "kind">>(
    kind: T
  ): Token<T>;

  declare function createModifiersFromModifierFlags(
    flags: $Values<typeof ModifierFlags>
  ): Modifier[];

  declare function createQualifiedName(
    left: EntityName,
    right: string | Identifier
  ): QualifiedName;

  declare function updateQualifiedName(
    node: QualifiedName,
    left: EntityName,
    right: Identifier
  ): QualifiedName;

  declare function createComputedPropertyName(
    expression: Expression
  ): ComputedPropertyName;

  declare function updateComputedPropertyName(
    node: ComputedPropertyName,
    expression: Expression
  ): ComputedPropertyName;

  declare function createTypeParameterDeclaration(
    name: string | Identifier,
    constraint?: TypeNode,
    defaultType?: TypeNode
  ): TypeParameterDeclaration;

  declare function updateTypeParameterDeclaration(
    node: TypeParameterDeclaration,
    name: Identifier,
    constraint: TypeNode | void,
    defaultType: TypeNode | void
  ): TypeParameterDeclaration;

  declare function createParameter(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    dotDotDotToken: DotDotDotToken | void,
    name: string | BindingName,
    questionToken?: QuestionToken,
    type?: TypeNode,
    initializer?: Expression
  ): ParameterDeclaration;

  declare function updateParameter(
    node: ParameterDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    dotDotDotToken: DotDotDotToken | void,
    name: string | BindingName,
    questionToken: QuestionToken | void,
    type: TypeNode | void,
    initializer: Expression | void
  ): ParameterDeclaration;

  declare function createDecorator(expression: Expression): Decorator;

  declare function updateDecorator(
    node: Decorator,
    expression: Expression
  ): Decorator;

  declare function createPropertySignature(
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: PropertyName | string,
    questionToken: QuestionToken | void,
    type: TypeNode | void,
    initializer: Expression | void
  ): PropertySignature;

  declare function updatePropertySignature(
    node: PropertySignature,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: PropertyName,
    questionToken: QuestionToken | void,
    type: TypeNode | void,
    initializer: Expression | void
  ): PropertySignature;

  declare function createProperty(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | PropertyName,
    questionOrExclamationToken: QuestionToken | ExclamationToken | void,
    type: TypeNode | void,
    initializer: Expression | void
  ): PropertyDeclaration;

  declare function updateProperty(
    node: PropertyDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | PropertyName,
    questionOrExclamationToken: QuestionToken | ExclamationToken | void,
    type: TypeNode | void,
    initializer: Expression | void
  ): PropertyDeclaration;

  declare function createMethodSignature(
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    name: string | PropertyName,
    questionToken: QuestionToken | void
  ): MethodSignature;

  declare function updateMethodSignature(
    node: MethodSignature,
    typeParameters: NodeArray<TypeParameterDeclaration> | void,
    parameters: NodeArray<ParameterDeclaration>,
    type: TypeNode | void,
    name: PropertyName,
    questionToken: QuestionToken | void
  ): MethodSignature;

  declare function createMethod(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    asteriskToken: AsteriskToken | void,
    name: string | PropertyName,
    questionToken: QuestionToken | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    body: Block | void
  ): MethodDeclaration;

  declare function updateMethod(
    node: MethodDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    asteriskToken: AsteriskToken | void,
    name: PropertyName,
    questionToken: QuestionToken | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    body: Block | void
  ): MethodDeclaration;

  declare function createConstructor(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    body: Block | void
  ): ConstructorDeclaration;

  declare function updateConstructor(
    node: ConstructorDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    body: Block | void
  ): ConstructorDeclaration;

  declare function createGetAccessor(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | PropertyName,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    body: Block | void
  ): GetAccessorDeclaration;

  declare function updateGetAccessor(
    node: GetAccessorDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: PropertyName,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    body: Block | void
  ): GetAccessorDeclaration;

  declare function createSetAccessor(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | PropertyName,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    body: Block | void
  ): SetAccessorDeclaration;

  declare function updateSetAccessor(
    node: SetAccessorDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: PropertyName,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    body: Block | void
  ): SetAccessorDeclaration;

  declare function createCallSignature(
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void
  ): CallSignatureDeclaration;

  declare function updateCallSignature(
    node: CallSignatureDeclaration,
    typeParameters: NodeArray<TypeParameterDeclaration> | void,
    parameters: NodeArray<ParameterDeclaration>,
    type: TypeNode | void
  ): CallSignatureDeclaration;

  declare function createConstructSignature(
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void
  ): ConstructSignatureDeclaration;

  declare function updateConstructSignature(
    node: ConstructSignatureDeclaration,
    typeParameters: NodeArray<TypeParameterDeclaration> | void,
    parameters: NodeArray<ParameterDeclaration>,
    type: TypeNode | void
  ): ConstructSignatureDeclaration;

  declare function createIndexSignature(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode
  ): IndexSignatureDeclaration;

  declare function updateIndexSignature(
    node: IndexSignatureDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode
  ): IndexSignatureDeclaration;

  declare function createKeywordTypeNode(
    kind: $ElementType<KeywordTypeNode, "kind">
  ): KeywordTypeNode;

  declare function createTypePredicateNode(
    parameterName: Identifier | ThisTypeNode | string,
    type: TypeNode
  ): TypePredicateNode;

  declare function updateTypePredicateNode(
    node: TypePredicateNode,
    parameterName: Identifier | ThisTypeNode,
    type: TypeNode
  ): TypePredicateNode;

  declare function createTypeReferenceNode(
    typeName: string | EntityName,
    typeArguments: $ReadOnlyArray<TypeNode> | void
  ): TypeReferenceNode;

  declare function updateTypeReferenceNode(
    node: TypeReferenceNode,
    typeName: EntityName,
    typeArguments: NodeArray<TypeNode> | void
  ): TypeReferenceNode;

  declare function createFunctionTypeNode(
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void
  ): FunctionTypeNode;

  declare function updateFunctionTypeNode(
    node: FunctionTypeNode,
    typeParameters: NodeArray<TypeParameterDeclaration> | void,
    parameters: NodeArray<ParameterDeclaration>,
    type: TypeNode | void
  ): FunctionTypeNode;

  declare function createConstructorTypeNode(
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void
  ): ConstructorTypeNode;

  declare function updateConstructorTypeNode(
    node: ConstructorTypeNode,
    typeParameters: NodeArray<TypeParameterDeclaration> | void,
    parameters: NodeArray<ParameterDeclaration>,
    type: TypeNode | void
  ): ConstructorTypeNode;

  declare function createTypeQueryNode(exprName: EntityName): TypeQueryNode;

  declare function updateTypeQueryNode(
    node: TypeQueryNode,
    exprName: EntityName
  ): TypeQueryNode;

  declare function createTypeLiteralNode(
    members: $ReadOnlyArray<TypeElement> | void
  ): TypeLiteralNode;

  declare function updateTypeLiteralNode(
    node: TypeLiteralNode,
    members: NodeArray<TypeElement>
  ): TypeLiteralNode;

  declare function createArrayTypeNode(elementType: TypeNode): ArrayTypeNode;

  declare function updateArrayTypeNode(
    node: ArrayTypeNode,
    elementType: TypeNode
  ): ArrayTypeNode;

  declare function createTupleTypeNode(
    elementTypes: $ReadOnlyArray<TypeNode>
  ): TupleTypeNode;

  declare function updateTupleTypeNode(
    node: TupleTypeNode,
    elementTypes: $ReadOnlyArray<TypeNode>
  ): TupleTypeNode;

  declare function createOptionalTypeNode(type: TypeNode): OptionalTypeNode;

  declare function updateOptionalTypeNode(
    node: OptionalTypeNode,
    type: TypeNode
  ): OptionalTypeNode;

  declare function createRestTypeNode(type: TypeNode): RestTypeNode;

  declare function updateRestTypeNode(
    node: RestTypeNode,
    type: TypeNode
  ): RestTypeNode;

  declare function createUnionTypeNode(
    types: $ReadOnlyArray<TypeNode>
  ): UnionTypeNode;

  declare function updateUnionTypeNode(
    node: UnionTypeNode,
    types: NodeArray<TypeNode>
  ): UnionTypeNode;

  declare function createIntersectionTypeNode(
    types: $ReadOnlyArray<TypeNode>
  ): IntersectionTypeNode;

  declare function updateIntersectionTypeNode(
    node: IntersectionTypeNode,
    types: NodeArray<TypeNode>
  ): IntersectionTypeNode;

  declare function createUnionOrIntersectionTypeNode(
    kind: typeof SyntaxKind.UnionType | typeof SyntaxKind.IntersectionType,
    types: $ReadOnlyArray<TypeNode>
  ): UnionOrIntersectionTypeNode;

  declare function createConditionalTypeNode(
    checkType: TypeNode,
    extendsType: TypeNode,
    trueType: TypeNode,
    falseType: TypeNode
  ): ConditionalTypeNode;

  declare function updateConditionalTypeNode(
    node: ConditionalTypeNode,
    checkType: TypeNode,
    extendsType: TypeNode,
    trueType: TypeNode,
    falseType: TypeNode
  ): ConditionalTypeNode;

  declare function createInferTypeNode(
    typeParameter: TypeParameterDeclaration
  ): InferTypeNode;

  declare function updateInferTypeNode(
    node: InferTypeNode,
    typeParameter: TypeParameterDeclaration
  ): InferTypeNode;

  declare function createImportTypeNode(
    argument: TypeNode,
    qualifier?: EntityName,
    typeArguments?: $ReadOnlyArray<TypeNode>,
    isTypeOf?: boolean
  ): ImportTypeNode;

  declare function updateImportTypeNode(
    node: ImportTypeNode,
    argument: TypeNode,
    qualifier?: EntityName,
    typeArguments?: $ReadOnlyArray<TypeNode>,
    isTypeOf?: boolean
  ): ImportTypeNode;

  declare function createParenthesizedType(
    type: TypeNode
  ): ParenthesizedTypeNode;

  declare function updateParenthesizedType(
    node: ParenthesizedTypeNode,
    type: TypeNode
  ): ParenthesizedTypeNode;

  declare function createThisTypeNode(): ThisTypeNode;

  declare function createTypeOperatorNode(type: TypeNode): TypeOperatorNode;

  declare function createTypeOperatorNode(
    operator: typeof SyntaxKind.KeyOfKeyword | typeof SyntaxKind.UniqueKeyword,
    type: TypeNode
  ): TypeOperatorNode;

  declare function updateTypeOperatorNode(
    node: TypeOperatorNode,
    type: TypeNode
  ): TypeOperatorNode;

  declare function createIndexedAccessTypeNode(
    objectType: TypeNode,
    indexType: TypeNode
  ): IndexedAccessTypeNode;

  declare function updateIndexedAccessTypeNode(
    node: IndexedAccessTypeNode,
    objectType: TypeNode,
    indexType: TypeNode
  ): IndexedAccessTypeNode;

  declare function createMappedTypeNode(
    readonlyToken: ReadonlyToken | PlusToken | MinusToken | void,
    typeParameter: TypeParameterDeclaration,
    questionToken: QuestionToken | PlusToken | MinusToken | void,
    type: TypeNode | void
  ): MappedTypeNode;

  declare function updateMappedTypeNode(
    node: MappedTypeNode,
    readonlyToken: ReadonlyToken | PlusToken | MinusToken | void,
    typeParameter: TypeParameterDeclaration,
    questionToken: QuestionToken | PlusToken | MinusToken | void,
    type: TypeNode | void
  ): MappedTypeNode;

  declare function createLiteralTypeNode(
    literal: $ElementType<LiteralTypeNode, "literal">
  ): LiteralTypeNode;

  declare function updateLiteralTypeNode(
    node: LiteralTypeNode,
    literal: $ElementType<LiteralTypeNode, "literal">
  ): LiteralTypeNode;

  declare function createObjectBindingPattern(
    elements: $ReadOnlyArray<BindingElement>
  ): ObjectBindingPattern;

  declare function updateObjectBindingPattern(
    node: ObjectBindingPattern,
    elements: $ReadOnlyArray<BindingElement>
  ): ObjectBindingPattern;

  declare function createArrayBindingPattern(
    elements: $ReadOnlyArray<ArrayBindingElement>
  ): ArrayBindingPattern;

  declare function updateArrayBindingPattern(
    node: ArrayBindingPattern,
    elements: $ReadOnlyArray<ArrayBindingElement>
  ): ArrayBindingPattern;

  declare function createBindingElement(
    dotDotDotToken: DotDotDotToken | void,
    propertyName: string | PropertyName | void,
    name: string | BindingName,
    initializer?: Expression
  ): BindingElement;

  declare function updateBindingElement(
    node: BindingElement,
    dotDotDotToken: DotDotDotToken | void,
    propertyName: PropertyName | void,
    name: BindingName,
    initializer: Expression | void
  ): BindingElement;

  declare function createArrayLiteral(
    elements?: $ReadOnlyArray<Expression>,
    multiLine?: boolean
  ): ArrayLiteralExpression;

  declare function updateArrayLiteral(
    node: ArrayLiteralExpression,
    elements: $ReadOnlyArray<Expression>
  ): ArrayLiteralExpression;

  declare function createObjectLiteral(
    properties?: $ReadOnlyArray<ObjectLiteralElementLike>,
    multiLine?: boolean
  ): ObjectLiteralExpression;

  declare function updateObjectLiteral(
    node: ObjectLiteralExpression,
    properties: $ReadOnlyArray<ObjectLiteralElementLike>
  ): ObjectLiteralExpression;

  declare function createPropertyAccess(
    expression: Expression,
    name: string | Identifier | void
  ): PropertyAccessExpression;

  declare function updatePropertyAccess(
    node: PropertyAccessExpression,
    expression: Expression,
    name: Identifier
  ): PropertyAccessExpression;

  declare function createElementAccess(
    expression: Expression,
    index: number | Expression
  ): ElementAccessExpression;

  declare function updateElementAccess(
    node: ElementAccessExpression,
    expression: Expression,
    argumentExpression: Expression
  ): ElementAccessExpression;

  declare function createCall(
    expression: Expression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    argumentsArray: $ReadOnlyArray<Expression> | void
  ): CallExpression;

  declare function updateCall(
    node: CallExpression,
    expression: Expression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    argumentsArray: $ReadOnlyArray<Expression>
  ): CallExpression;

  declare function createNew(
    expression: Expression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    argumentsArray: $ReadOnlyArray<Expression> | void
  ): NewExpression;

  declare function updateNew(
    node: NewExpression,
    expression: Expression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    argumentsArray: $ReadOnlyArray<Expression> | void
  ): NewExpression;

  declare function createTaggedTemplate(
    tag: Expression,
    template: TemplateLiteral
  ): TaggedTemplateExpression;

  declare function createTaggedTemplate(
    tag: Expression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    template: TemplateLiteral
  ): TaggedTemplateExpression;

  declare function updateTaggedTemplate(
    node: TaggedTemplateExpression,
    tag: Expression,
    template: TemplateLiteral
  ): TaggedTemplateExpression;

  declare function updateTaggedTemplate(
    node: TaggedTemplateExpression,
    tag: Expression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    template: TemplateLiteral
  ): TaggedTemplateExpression;

  declare function createTypeAssertion(
    type: TypeNode,
    expression: Expression
  ): TypeAssertion;

  declare function updateTypeAssertion(
    node: TypeAssertion,
    type: TypeNode,
    expression: Expression
  ): TypeAssertion;

  declare function createParen(expression: Expression): ParenthesizedExpression;

  declare function updateParen(
    node: ParenthesizedExpression,
    expression: Expression
  ): ParenthesizedExpression;

  declare function createFunctionExpression(
    modifiers: $ReadOnlyArray<Modifier> | void,
    asteriskToken: AsteriskToken | void,
    name: string | Identifier | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration> | void,
    type: TypeNode | void,
    body: Block
  ): FunctionExpression;

  declare function updateFunctionExpression(
    node: FunctionExpression,
    modifiers: $ReadOnlyArray<Modifier> | void,
    asteriskToken: AsteriskToken | void,
    name: Identifier | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    body: Block
  ): FunctionExpression;

  declare function createArrowFunction(
    modifiers: $ReadOnlyArray<Modifier> | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    equalsGreaterThanToken: EqualsGreaterThanToken | void,
    body: ConciseBody
  ): ArrowFunction;

  declare function updateArrowFunction(
    node: ArrowFunction,
    modifiers: $ReadOnlyArray<Modifier> | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    equalsGreaterThanToken: Token<typeof SyntaxKind.EqualsGreaterThanToken>,
    body: ConciseBody
  ): ArrowFunction;

  declare function createDelete(expression: Expression): DeleteExpression;

  declare function updateDelete(
    node: DeleteExpression,
    expression: Expression
  ): DeleteExpression;

  declare function createTypeOf(expression: Expression): TypeOfExpression;

  declare function updateTypeOf(
    node: TypeOfExpression,
    expression: Expression
  ): TypeOfExpression;

  declare function createVoid(expression: Expression): VoidExpression;

  declare function updateVoid(
    node: VoidExpression,
    expression: Expression
  ): VoidExpression;

  declare function createAwait(expression: Expression): AwaitExpression;

  declare function updateAwait(
    node: AwaitExpression,
    expression: Expression
  ): AwaitExpression;

  declare function createPrefix(
    operator: PrefixUnaryOperator,
    operand: Expression
  ): PrefixUnaryExpression;

  declare function updatePrefix(
    node: PrefixUnaryExpression,
    operand: Expression
  ): PrefixUnaryExpression;

  declare function createPostfix(
    operand: Expression,
    operator: PostfixUnaryOperator
  ): PostfixUnaryExpression;

  declare function updatePostfix(
    node: PostfixUnaryExpression,
    operand: Expression
  ): PostfixUnaryExpression;

  declare function createBinary(
    left: Expression,
    operator: BinaryOperator | BinaryOperatorToken,
    right: Expression
  ): BinaryExpression;

  declare function updateBinary(
    node: BinaryExpression,
    left: Expression,
    right: Expression,
    operator?: BinaryOperator | BinaryOperatorToken
  ): BinaryExpression;

  declare function createConditional(
    condition: Expression,
    whenTrue: Expression,
    whenFalse: Expression
  ): ConditionalExpression;

  declare function createConditional(
    condition: Expression,
    questionToken: QuestionToken,
    whenTrue: Expression,
    colonToken: ColonToken,
    whenFalse: Expression
  ): ConditionalExpression;

  declare function updateConditional(
    node: ConditionalExpression,
    condition: Expression,
    questionToken: Token<typeof SyntaxKind.QuestionToken>,
    whenTrue: Expression,
    colonToken: Token<typeof SyntaxKind.ColonToken>,
    whenFalse: Expression
  ): ConditionalExpression;

  declare function createTemplateExpression(
    head: TemplateHead,
    templateSpans: $ReadOnlyArray<TemplateSpan>
  ): TemplateExpression;

  declare function updateTemplateExpression(
    node: TemplateExpression,
    head: TemplateHead,
    templateSpans: $ReadOnlyArray<TemplateSpan>
  ): TemplateExpression;

  declare function createTemplateHead(text: string): TemplateHead;

  declare function createTemplateMiddle(text: string): TemplateMiddle;

  declare function createTemplateTail(text: string): TemplateTail;

  declare function createNoSubstitutionTemplateLiteral(
    text: string
  ): NoSubstitutionTemplateLiteral;

  declare function createYield(expression?: Expression): YieldExpression;

  declare function createYield(
    asteriskToken: AsteriskToken | void,
    expression: Expression
  ): YieldExpression;

  declare function updateYield(
    node: YieldExpression,
    asteriskToken: AsteriskToken | void,
    expression: Expression
  ): YieldExpression;

  declare function createSpread(expression: Expression): SpreadElement;

  declare function updateSpread(
    node: SpreadElement,
    expression: Expression
  ): SpreadElement;

  declare function createClassExpression(
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | Identifier | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    heritageClauses: $ReadOnlyArray<HeritageClause> | void,
    members: $ReadOnlyArray<ClassElement>
  ): ClassExpression;

  declare function updateClassExpression(
    node: ClassExpression,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: Identifier | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    heritageClauses: $ReadOnlyArray<HeritageClause> | void,
    members: $ReadOnlyArray<ClassElement>
  ): ClassExpression;

  declare function createOmittedExpression(): OmittedExpression;

  declare function createExpressionWithTypeArguments(
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    expression: Expression
  ): ExpressionWithTypeArguments;

  declare function updateExpressionWithTypeArguments(
    node: ExpressionWithTypeArguments,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    expression: Expression
  ): ExpressionWithTypeArguments;

  declare function createAsExpression(
    expression: Expression,
    type: TypeNode
  ): AsExpression;

  declare function updateAsExpression(
    node: AsExpression,
    expression: Expression,
    type: TypeNode
  ): AsExpression;

  declare function createNonNullExpression(
    expression: Expression
  ): NonNullExpression;

  declare function updateNonNullExpression(
    node: NonNullExpression,
    expression: Expression
  ): NonNullExpression;

  declare function createMetaProperty(
    keywordToken: $ElementType<MetaProperty, "keywordToken">,
    name: Identifier
  ): MetaProperty;

  declare function updateMetaProperty(
    node: MetaProperty,
    name: Identifier
  ): MetaProperty;

  declare function createTemplateSpan(
    expression: Expression,
    literal: TemplateMiddle | TemplateTail
  ): TemplateSpan;

  declare function updateTemplateSpan(
    node: TemplateSpan,
    expression: Expression,
    literal: TemplateMiddle | TemplateTail
  ): TemplateSpan;

  declare function createSemicolonClassElement(): SemicolonClassElement;

  declare function createBlock(
    statements: $ReadOnlyArray<Statement>,
    multiLine?: boolean
  ): Block;

  declare function updateBlock(
    node: Block,
    statements: $ReadOnlyArray<Statement>
  ): Block;

  declare function createVariableStatement(
    modifiers: $ReadOnlyArray<Modifier> | void,
    declarationList:
      | VariableDeclarationList
      | $ReadOnlyArray<VariableDeclaration>
  ): VariableStatement;

  declare function updateVariableStatement(
    node: VariableStatement,
    modifiers: $ReadOnlyArray<Modifier> | void,
    declarationList: VariableDeclarationList
  ): VariableStatement;

  declare function createEmptyStatement(): EmptyStatement;

  declare function createExpressionStatement(
    expression: Expression
  ): ExpressionStatement;

  declare function updateExpressionStatement(
    node: ExpressionStatement,
    expression: Expression
  ): ExpressionStatement;

  declare var createStatement: typeof createExpressionStatement;
  declare var updateStatement: typeof updateExpressionStatement;
  declare function createIf(
    expression: Expression,
    thenStatement: Statement,
    elseStatement?: Statement
  ): IfStatement;

  declare function updateIf(
    node: IfStatement,
    expression: Expression,
    thenStatement: Statement,
    elseStatement: Statement | void
  ): IfStatement;

  declare function createDo(
    statement: Statement,
    expression: Expression
  ): DoStatement;

  declare function updateDo(
    node: DoStatement,
    statement: Statement,
    expression: Expression
  ): DoStatement;

  declare function createWhile(
    expression: Expression,
    statement: Statement
  ): WhileStatement;

  declare function updateWhile(
    node: WhileStatement,
    expression: Expression,
    statement: Statement
  ): WhileStatement;

  declare function createFor(
    initializer: ForInitializer | void,
    condition: Expression | void,
    incrementor: Expression | void,
    statement: Statement
  ): ForStatement;

  declare function updateFor(
    node: ForStatement,
    initializer: ForInitializer | void,
    condition: Expression | void,
    incrementor: Expression | void,
    statement: Statement
  ): ForStatement;

  declare function createForIn(
    initializer: ForInitializer,
    expression: Expression,
    statement: Statement
  ): ForInStatement;

  declare function updateForIn(
    node: ForInStatement,
    initializer: ForInitializer,
    expression: Expression,
    statement: Statement
  ): ForInStatement;

  declare function createForOf(
    awaitModifier: AwaitKeywordToken | void,
    initializer: ForInitializer,
    expression: Expression,
    statement: Statement
  ): ForOfStatement;

  declare function updateForOf(
    node: ForOfStatement,
    awaitModifier: AwaitKeywordToken | void,
    initializer: ForInitializer,
    expression: Expression,
    statement: Statement
  ): ForOfStatement;

  declare function createContinue(
    label?: string | Identifier
  ): ContinueStatement;

  declare function updateContinue(
    node: ContinueStatement,
    label: Identifier | void
  ): ContinueStatement;

  declare function createBreak(label?: string | Identifier): BreakStatement;

  declare function updateBreak(
    node: BreakStatement,
    label: Identifier | void
  ): BreakStatement;

  declare function createReturn(expression?: Expression): ReturnStatement;

  declare function updateReturn(
    node: ReturnStatement,
    expression: Expression | void
  ): ReturnStatement;

  declare function createWith(
    expression: Expression,
    statement: Statement
  ): WithStatement;

  declare function updateWith(
    node: WithStatement,
    expression: Expression,
    statement: Statement
  ): WithStatement;

  declare function createSwitch(
    expression: Expression,
    caseBlock: CaseBlock
  ): SwitchStatement;

  declare function updateSwitch(
    node: SwitchStatement,
    expression: Expression,
    caseBlock: CaseBlock
  ): SwitchStatement;

  declare function createLabel(
    label: string | Identifier,
    statement: Statement
  ): LabeledStatement;

  declare function updateLabel(
    node: LabeledStatement,
    label: Identifier,
    statement: Statement
  ): LabeledStatement;

  declare function createThrow(expression: Expression): ThrowStatement;

  declare function updateThrow(
    node: ThrowStatement,
    expression: Expression
  ): ThrowStatement;

  declare function createTry(
    tryBlock: Block,
    catchClause: CatchClause | void,
    finallyBlock: Block | void
  ): TryStatement;

  declare function updateTry(
    node: TryStatement,
    tryBlock: Block,
    catchClause: CatchClause | void,
    finallyBlock: Block | void
  ): TryStatement;

  declare function createDebuggerStatement(): DebuggerStatement;

  declare function createVariableDeclaration(
    name: string | BindingName,
    type?: TypeNode,
    initializer?: Expression
  ): VariableDeclaration;

  declare function updateVariableDeclaration(
    node: VariableDeclaration,
    name: BindingName,
    type: TypeNode | void,
    initializer: Expression | void
  ): VariableDeclaration;

  declare function createVariableDeclarationList(
    declarations: $ReadOnlyArray<VariableDeclaration>,
    flags?: $Values<typeof NodeFlags>
  ): VariableDeclarationList;

  declare function updateVariableDeclarationList(
    node: VariableDeclarationList,
    declarations: $ReadOnlyArray<VariableDeclaration>
  ): VariableDeclarationList;

  declare function createFunctionDeclaration(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    asteriskToken: AsteriskToken | void,
    name: string | Identifier | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    body: Block | void
  ): FunctionDeclaration;

  declare function updateFunctionDeclaration(
    node: FunctionDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    asteriskToken: AsteriskToken | void,
    name: Identifier | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    parameters: $ReadOnlyArray<ParameterDeclaration>,
    type: TypeNode | void,
    body: Block | void
  ): FunctionDeclaration;

  declare function createClassDeclaration(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | Identifier | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    heritageClauses: $ReadOnlyArray<HeritageClause> | void,
    members: $ReadOnlyArray<ClassElement>
  ): ClassDeclaration;

  declare function updateClassDeclaration(
    node: ClassDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: Identifier | void,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    heritageClauses: $ReadOnlyArray<HeritageClause> | void,
    members: $ReadOnlyArray<ClassElement>
  ): ClassDeclaration;

  declare function createInterfaceDeclaration(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | Identifier,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    heritageClauses: $ReadOnlyArray<HeritageClause> | void,
    members: $ReadOnlyArray<TypeElement>
  ): InterfaceDeclaration;

  declare function updateInterfaceDeclaration(
    node: InterfaceDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: Identifier,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    heritageClauses: $ReadOnlyArray<HeritageClause> | void,
    members: $ReadOnlyArray<TypeElement>
  ): InterfaceDeclaration;

  declare function createTypeAliasDeclaration(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | Identifier,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    type: TypeNode
  ): TypeAliasDeclaration;

  declare function updateTypeAliasDeclaration(
    node: TypeAliasDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: Identifier,
    typeParameters: $ReadOnlyArray<TypeParameterDeclaration> | void,
    type: TypeNode
  ): TypeAliasDeclaration;

  declare function createEnumDeclaration(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | Identifier,
    members: $ReadOnlyArray<EnumMember>
  ): EnumDeclaration;

  declare function updateEnumDeclaration(
    node: EnumDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: Identifier,
    members: $ReadOnlyArray<EnumMember>
  ): EnumDeclaration;

  declare function createModuleDeclaration(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: ModuleName,
    body: ModuleBody | void,
    flags?: $Values<typeof NodeFlags>
  ): ModuleDeclaration;

  declare function updateModuleDeclaration(
    node: ModuleDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: ModuleName,
    body: ModuleBody | void
  ): ModuleDeclaration;

  declare function createModuleBlock(
    statements: $ReadOnlyArray<Statement>
  ): ModuleBlock;

  declare function updateModuleBlock(
    node: ModuleBlock,
    statements: $ReadOnlyArray<Statement>
  ): ModuleBlock;

  declare function createCaseBlock(
    clauses: $ReadOnlyArray<CaseOrDefaultClause>
  ): CaseBlock;

  declare function updateCaseBlock(
    node: CaseBlock,
    clauses: $ReadOnlyArray<CaseOrDefaultClause>
  ): CaseBlock;

  declare function createNamespaceExportDeclaration(
    name: string | Identifier
  ): NamespaceExportDeclaration;

  declare function updateNamespaceExportDeclaration(
    node: NamespaceExportDeclaration,
    name: Identifier
  ): NamespaceExportDeclaration;

  declare function createImportEqualsDeclaration(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: string | Identifier,
    moduleReference: ModuleReference
  ): ImportEqualsDeclaration;

  declare function updateImportEqualsDeclaration(
    node: ImportEqualsDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    name: Identifier,
    moduleReference: ModuleReference
  ): ImportEqualsDeclaration;

  declare function createImportDeclaration(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    importClause: ImportClause | void,
    moduleSpecifier: Expression
  ): ImportDeclaration;

  declare function updateImportDeclaration(
    node: ImportDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    importClause: ImportClause | void,
    moduleSpecifier: Expression
  ): ImportDeclaration;

  declare function createImportClause(
    name: Identifier | void,
    namedBindings: NamedImportBindings | void
  ): ImportClause;

  declare function updateImportClause(
    node: ImportClause,
    name: Identifier | void,
    namedBindings: NamedImportBindings | void
  ): ImportClause;

  declare function createNamespaceImport(name: Identifier): NamespaceImport;

  declare function updateNamespaceImport(
    node: NamespaceImport,
    name: Identifier
  ): NamespaceImport;

  declare function createNamedImports(
    elements: $ReadOnlyArray<ImportSpecifier>
  ): NamedImports;

  declare function updateNamedImports(
    node: NamedImports,
    elements: $ReadOnlyArray<ImportSpecifier>
  ): NamedImports;

  declare function createImportSpecifier(
    propertyName: Identifier | void,
    name: Identifier
  ): ImportSpecifier;

  declare function updateImportSpecifier(
    node: ImportSpecifier,
    propertyName: Identifier | void,
    name: Identifier
  ): ImportSpecifier;

  declare function createExportAssignment(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    isExportEquals: boolean | void,
    expression: Expression
  ): ExportAssignment;

  declare function updateExportAssignment(
    node: ExportAssignment,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    expression: Expression
  ): ExportAssignment;

  declare function createExportDeclaration(
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    exportClause: NamedExports | void,
    moduleSpecifier?: Expression
  ): ExportDeclaration;

  declare function updateExportDeclaration(
    node: ExportDeclaration,
    decorators: $ReadOnlyArray<Decorator> | void,
    modifiers: $ReadOnlyArray<Modifier> | void,
    exportClause: NamedExports | void,
    moduleSpecifier: Expression | void
  ): ExportDeclaration;

  declare function createNamedExports(
    elements: $ReadOnlyArray<ExportSpecifier>
  ): NamedExports;

  declare function updateNamedExports(
    node: NamedExports,
    elements: $ReadOnlyArray<ExportSpecifier>
  ): NamedExports;

  declare function createExportSpecifier(
    propertyName: string | Identifier | void,
    name: string | Identifier
  ): ExportSpecifier;

  declare function updateExportSpecifier(
    node: ExportSpecifier,
    propertyName: Identifier | void,
    name: Identifier
  ): ExportSpecifier;

  declare function createExternalModuleReference(
    expression: Expression
  ): ExternalModuleReference;

  declare function updateExternalModuleReference(
    node: ExternalModuleReference,
    expression: Expression
  ): ExternalModuleReference;

  declare function createJsxElement(
    openingElement: JsxOpeningElement,
    children: $ReadOnlyArray<JsxChild>,
    closingElement: JsxClosingElement
  ): JsxElement;

  declare function updateJsxElement(
    node: JsxElement,
    openingElement: JsxOpeningElement,
    children: $ReadOnlyArray<JsxChild>,
    closingElement: JsxClosingElement
  ): JsxElement;

  declare function createJsxSelfClosingElement(
    tagName: JsxTagNameExpression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    attributes: JsxAttributes
  ): JsxSelfClosingElement;

  declare function updateJsxSelfClosingElement(
    node: JsxSelfClosingElement,
    tagName: JsxTagNameExpression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    attributes: JsxAttributes
  ): JsxSelfClosingElement;

  declare function createJsxOpeningElement(
    tagName: JsxTagNameExpression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    attributes: JsxAttributes
  ): JsxOpeningElement;

  declare function updateJsxOpeningElement(
    node: JsxOpeningElement,
    tagName: JsxTagNameExpression,
    typeArguments: $ReadOnlyArray<TypeNode> | void,
    attributes: JsxAttributes
  ): JsxOpeningElement;

  declare function createJsxClosingElement(
    tagName: JsxTagNameExpression
  ): JsxClosingElement;

  declare function updateJsxClosingElement(
    node: JsxClosingElement,
    tagName: JsxTagNameExpression
  ): JsxClosingElement;

  declare function createJsxFragment(
    openingFragment: JsxOpeningFragment,
    children: $ReadOnlyArray<JsxChild>,
    closingFragment: JsxClosingFragment
  ): JsxFragment;

  declare function updateJsxFragment(
    node: JsxFragment,
    openingFragment: JsxOpeningFragment,
    children: $ReadOnlyArray<JsxChild>,
    closingFragment: JsxClosingFragment
  ): JsxFragment;

  declare function createJsxAttribute(
    name: Identifier,
    initializer: StringLiteral | JsxExpression
  ): JsxAttribute;

  declare function updateJsxAttribute(
    node: JsxAttribute,
    name: Identifier,
    initializer: StringLiteral | JsxExpression
  ): JsxAttribute;

  declare function createJsxAttributes(
    properties: $ReadOnlyArray<JsxAttributeLike>
  ): JsxAttributes;

  declare function updateJsxAttributes(
    node: JsxAttributes,
    properties: $ReadOnlyArray<JsxAttributeLike>
  ): JsxAttributes;

  declare function createJsxSpreadAttribute(
    expression: Expression
  ): JsxSpreadAttribute;

  declare function updateJsxSpreadAttribute(
    node: JsxSpreadAttribute,
    expression: Expression
  ): JsxSpreadAttribute;

  declare function createJsxExpression(
    dotDotDotToken: DotDotDotToken | void,
    expression: Expression | void
  ): JsxExpression;

  declare function updateJsxExpression(
    node: JsxExpression,
    expression: Expression | void
  ): JsxExpression;

  declare function createCaseClause(
    expression: Expression,
    statements: $ReadOnlyArray<Statement>
  ): CaseClause;

  declare function updateCaseClause(
    node: CaseClause,
    expression: Expression,
    statements: $ReadOnlyArray<Statement>
  ): CaseClause;

  declare function createDefaultClause(
    statements: $ReadOnlyArray<Statement>
  ): DefaultClause;

  declare function updateDefaultClause(
    node: DefaultClause,
    statements: $ReadOnlyArray<Statement>
  ): DefaultClause;

  declare function createHeritageClause(
    token: $ElementType<HeritageClause, "token">,
    types: $ReadOnlyArray<ExpressionWithTypeArguments>
  ): HeritageClause;

  declare function updateHeritageClause(
    node: HeritageClause,
    types: $ReadOnlyArray<ExpressionWithTypeArguments>
  ): HeritageClause;

  declare function createCatchClause(
    variableDeclaration: string | VariableDeclaration | void,
    block: Block
  ): CatchClause;

  declare function updateCatchClause(
    node: CatchClause,
    variableDeclaration: VariableDeclaration | void,
    block: Block
  ): CatchClause;

  declare function createPropertyAssignment(
    name: string | PropertyName,
    initializer: Expression
  ): PropertyAssignment;

  declare function updatePropertyAssignment(
    node: PropertyAssignment,
    name: PropertyName,
    initializer: Expression
  ): PropertyAssignment;

  declare function createShorthandPropertyAssignment(
    name: string | Identifier,
    objectAssignmentInitializer?: Expression
  ): ShorthandPropertyAssignment;

  declare function updateShorthandPropertyAssignment(
    node: ShorthandPropertyAssignment,
    name: Identifier,
    objectAssignmentInitializer: Expression | void
  ): ShorthandPropertyAssignment;

  declare function createSpreadAssignment(
    expression: Expression
  ): SpreadAssignment;

  declare function updateSpreadAssignment(
    node: SpreadAssignment,
    expression: Expression
  ): SpreadAssignment;

  declare function createEnumMember(
    name: string | PropertyName,
    initializer?: Expression
  ): EnumMember;

  declare function updateEnumMember(
    node: EnumMember,
    name: PropertyName,
    initializer: Expression | void
  ): EnumMember;

  declare function updateSourceFileNode(
    node: SourceFile,
    statements: $ReadOnlyArray<Statement>,
    isDeclarationFile?: boolean,
    referencedFiles?: $ElementType<SourceFile, "referencedFiles">,
    typeReferences?: $ElementType<SourceFile, "typeReferenceDirectives">,
    hasNoDefaultLib?: boolean,
    libReferences?: $ElementType<SourceFile, "libReferenceDirectives">
  ): SourceFile;

  declare function getMutableClone<T: Node>(node: T): T;

  declare function createNotEmittedStatement(
    original: Node
  ): NotEmittedStatement;

  declare function createPartiallyEmittedExpression(
    expression: Expression,
    original?: Node
  ): PartiallyEmittedExpression;

  declare function updatePartiallyEmittedExpression(
    node: PartiallyEmittedExpression,
    expression: Expression
  ): PartiallyEmittedExpression;

  declare function createCommaList(
    elements: $ReadOnlyArray<Expression>
  ): CommaListExpression;

  declare function updateCommaList(
    node: CommaListExpression,
    elements: $ReadOnlyArray<Expression>
  ): CommaListExpression;

  declare function createBundle(
    sourceFiles: $ReadOnlyArray<SourceFile>,
    prepends?: $ReadOnlyArray<UnparsedSource | InputFiles>
  ): Bundle;

  declare function createUnparsedSourceFile(text: string): UnparsedSource;

  declare function createUnparsedSourceFile(
    inputFile: InputFiles,
    type: "js" | "dts"
  ): UnparsedSource;

  declare function createUnparsedSourceFile(
    text: string,
    mapPath: string | void,
    map: string | void
  ): UnparsedSource;

  declare function createInputFiles(
    javascriptText: string,
    declarationText: string
  ): InputFiles;

  declare function createInputFiles(
    readFileText: (path: string) => string | void,
    javascriptPath: string,
    javascriptMapPath: string | void,
    declarationPath: string,
    declarationMapPath: string | void
  ): InputFiles;

  declare function createInputFiles(
    javascriptText: string,
    declarationText: string,
    javascriptMapPath: string | void,
    javascriptMapText: string | void,
    declarationMapPath: string | void,
    declarationMapText: string | void
  ): InputFiles;

  declare function updateBundle(
    node: Bundle,
    sourceFiles: $ReadOnlyArray<SourceFile>,
    prepends?: $ReadOnlyArray<UnparsedSource>
  ): Bundle;

  declare function createImmediatelyInvokedFunctionExpression(
    statements: $ReadOnlyArray<Statement>
  ): CallExpression;

  declare function createImmediatelyInvokedFunctionExpression(
    statements: $ReadOnlyArray<Statement>,
    param: ParameterDeclaration,
    paramValue: Expression
  ): CallExpression;

  declare function createImmediatelyInvokedArrowFunction(
    statements: $ReadOnlyArray<Statement>
  ): CallExpression;

  declare function createImmediatelyInvokedArrowFunction(
    statements: $ReadOnlyArray<Statement>,
    param: ParameterDeclaration,
    paramValue: Expression
  ): CallExpression;

  declare function createComma(left: Expression, right: Expression): Expression;

  declare function createLessThan(
    left: Expression,
    right: Expression
  ): Expression;

  declare function createAssignment(
    left: ObjectLiteralExpression | ArrayLiteralExpression,
    right: Expression
  ): DestructuringAssignment;

  declare function createAssignment(
    left: Expression,
    right: Expression
  ): BinaryExpression;

  declare function createStrictEquality(
    left: Expression,
    right: Expression
  ): BinaryExpression;

  declare function createStrictInequality(
    left: Expression,
    right: Expression
  ): BinaryExpression;

  declare function createAdd(
    left: Expression,
    right: Expression
  ): BinaryExpression;

  declare function createSubtract(
    left: Expression,
    right: Expression
  ): BinaryExpression;

  declare function createPostfixIncrement(
    operand: Expression
  ): PostfixUnaryExpression;

  declare function createLogicalAnd(
    left: Expression,
    right: Expression
  ): BinaryExpression;

  declare function createLogicalOr(
    left: Expression,
    right: Expression
  ): BinaryExpression;

  declare function createLogicalNot(operand: Expression): PrefixUnaryExpression;

  declare function createVoidZero(): VoidExpression;

  declare function createExportDefault(
    expression: Expression
  ): ExportAssignment;

  declare function createExternalModuleExport(
    exportName: Identifier
  ): ExportDeclaration;

  declare function disposeEmitNodes(sourceFile: SourceFile): void;

  declare function setTextRange<T: TextRange>(
    range: T,
    location: TextRange | void
  ): T;

  declare function setEmitFlags<T: Node>(
    node: T,
    emitFlags: $Values<typeof EmitFlags>
  ): T;

  declare function getSourceMapRange(node: Node): SourceMapRange;

  declare function setSourceMapRange<T: Node>(
    node: T,
    range: SourceMapRange | void
  ): T;

  declare function createSourceMapSource(
    fileName: string,
    text: string,
    skipTrivia?: (pos: number) => number
  ): SourceMapSource;

  declare function getTokenSourceMapRange(
    node: Node,
    token: $Values<typeof SyntaxKind>
  ): SourceMapRange | void;

  declare function setTokenSourceMapRange<T: Node>(
    node: T,
    token: $Values<typeof SyntaxKind>,
    range: SourceMapRange | void
  ): T;

  declare function getCommentRange(node: Node): TextRange;

  declare function setCommentRange<T: Node>(node: T, range: TextRange): T;

  declare function getSyntheticLeadingComments(
    node: Node
  ): SynthesizedComment[] | void;

  declare function setSyntheticLeadingComments<T: Node>(
    node: T,
    comments: SynthesizedComment[] | void
  ): T;

  declare function addSyntheticLeadingComment<T: Node>(
    node: T,
    kind:
      | typeof SyntaxKind.SingleLineCommentTrivia
      | typeof SyntaxKind.MultiLineCommentTrivia,
    text: string,
    hasTrailingNewLine?: boolean
  ): T;

  declare function getSyntheticTrailingComments(
    node: Node
  ): SynthesizedComment[] | void;

  declare function setSyntheticTrailingComments<T: Node>(
    node: T,
    comments: SynthesizedComment[] | void
  ): T;

  declare function addSyntheticTrailingComment<T: Node>(
    node: T,
    kind:
      | typeof SyntaxKind.SingleLineCommentTrivia
      | typeof SyntaxKind.MultiLineCommentTrivia,
    text: string,
    hasTrailingNewLine?: boolean
  ): T;

  declare function moveSyntheticComments<T: Node>(node: T, original: Node): T;

  declare function getConstantValue(
    node: PropertyAccessExpression | ElementAccessExpression
  ): string | number | void;

  declare function setConstantValue(
    node: PropertyAccessExpression | ElementAccessExpression,
    value: string | number
  ): PropertyAccessExpression | ElementAccessExpression;

  declare function addEmitHelper<T: Node>(node: T, helper: EmitHelper): T;

  declare function addEmitHelpers<T: Node>(
    node: T,
    helpers: EmitHelper[] | void
  ): T;

  declare function removeEmitHelper(node: Node, helper: EmitHelper): boolean;

  declare function getEmitHelpers(node: Node): EmitHelper[] | void;

  declare function moveEmitHelpers(
    source: Node,
    target: Node,
    predicate: (helper: EmitHelper) => boolean
  ): void;

  declare function setOriginalNode<T: Node>(node: T, original: Node | void): T;

  declare function visitNode<T: Node>(
    node: T | void,
    visitor: Visitor | void,
    test?: (node: Node) => boolean,
    lift?: (node: NodeArray<Node>) => T
  ): T;

  declare function visitNode<T: Node>(
    node: T | void,
    visitor: Visitor | void,
    test?: (node: Node) => boolean,
    lift?: (node: NodeArray<Node>) => T
  ): T | void;

  declare function visitNodes<T: Node>(
    nodes: NodeArray<T> | void,
    visitor: Visitor,
    test?: (node: Node) => boolean,
    start?: number,
    count?: number
  ): NodeArray<T>;

  declare function visitNodes<T: Node>(
    nodes: NodeArray<T> | void,
    visitor: Visitor,
    test?: (node: Node) => boolean,
    start?: number,
    count?: number
  ): NodeArray<T> | void;

  declare function visitLexicalEnvironment(
    statements: NodeArray<Statement>,
    visitor: Visitor,
    context: TransformationContext,
    start?: number,
    ensureUseStrict?: boolean
  ): NodeArray<Statement>;

  declare function visitParameterList(
    nodes: NodeArray<ParameterDeclaration> | void,
    visitor: Visitor,
    context: TransformationContext,
    nodesVisitor?: typeof visitNodes
  ): NodeArray<ParameterDeclaration>;

  declare function visitFunctionBody(
    node: FunctionBody,
    visitor: Visitor,
    context: TransformationContext
  ): FunctionBody;

  declare function visitFunctionBody(
    node: FunctionBody | void,
    visitor: Visitor,
    context: TransformationContext
  ): FunctionBody | void;

  declare function visitFunctionBody(
    node: ConciseBody,
    visitor: Visitor,
    context: TransformationContext
  ): ConciseBody;

  declare function visitEachChild<T: Node>(
    node: T,
    visitor: Visitor,
    context: TransformationContext
  ): T;

  declare function visitEachChild<T: Node>(
    node: T | void,
    visitor: Visitor,
    context: TransformationContext,
    nodesVisitor?: typeof visitNodes,
    tokenVisitor?: Visitor
  ): T | void;

  declare function createPrinter(
    printerOptions?: PrinterOptions,
    handlers?: PrintHandlers
  ): Printer;

  declare function findConfigFile(
    searchPath: string,
    fileExists: (fileName: string) => boolean,
    configName?: string
  ): string | void;

  declare function resolveTripleslashReference(
    moduleName: string,
    containingFile: string
  ): string;

  declare function createCompilerHost(
    options: CompilerOptions,
    setParentNodes?: boolean
  ): CompilerHost;

  declare function getPreEmitDiagnostics(
    program: Program,
    sourceFile?: SourceFile,
    cancellationToken?: CancellationToken
  ): $ReadOnlyArray<Diagnostic>;

  declare type FormatDiagnosticsHost = {
    getCurrentDirectory(): string,
    getCanonicalFileName(fileName: string): string,
    getNewLine(): string,
    ...
  };

  declare function formatDiagnostics(
    diagnostics: $ReadOnlyArray<Diagnostic>,
    host: FormatDiagnosticsHost
  ): string;

  declare function formatDiagnostic(
    diagnostic: Diagnostic,
    host: FormatDiagnosticsHost
  ): string;

  declare function formatDiagnosticsWithColorAndContext(
    diagnostics: $ReadOnlyArray<Diagnostic>,
    host: FormatDiagnosticsHost
  ): string;

  declare function flattenDiagnosticMessageText(
    messageText: string | DiagnosticMessageChain | void,
    newLine: string
  ): string;

  declare function getConfigFileParsingDiagnostics(
    configFileParseResult: ParsedCommandLine
  ): $ReadOnlyArray<Diagnostic>;

  declare function createProgram(
    createProgramOptions: CreateProgramOptions
  ): Program;

  declare function createProgram(
    rootNames: $ReadOnlyArray<string>,
    options: CompilerOptions,
    host?: CompilerHost,
    oldProgram?: Program,
    configFileParsingDiagnostics?: $ReadOnlyArray<Diagnostic>
  ): Program;

  declare type ResolveProjectReferencePathHost = { fileExists(fileName: string): boolean, ... };

  declare function resolveProjectReferencePath(
    ref: ProjectReference
  ): ResolvedConfigFileName;

  declare function resolveProjectReferencePath(
    host: ResolveProjectReferencePathHost,
    ref: ProjectReference
  ): ResolvedConfigFileName;

  declare type EmitOutput = {
    outputFiles: OutputFile[],
    emitSkipped: boolean,
    ...
  };

  declare type OutputFile = {
    name: string,
    writeByteOrderMark: boolean,
    text: string,
    ...
  };

  declare type AffectedFileResult<T> = {
    result: T,
    affected: SourceFile | Program,
    ...
  } | void;
  declare type BuilderProgramHost = {
    useCaseSensitiveFileNames(): boolean,
    createHash?: (data: string) => string,
    writeFile?: WriteFileCallback,
    ...
  };

  declare type BuilderProgram = {
    getProgram(): Program,
    getCompilerOptions(): CompilerOptions,
    getSourceFile(fileName: string): SourceFile | void,
    getSourceFiles(): $ReadOnlyArray<SourceFile>,
    getOptionsDiagnostics(
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<Diagnostic>,
    getGlobalDiagnostics(
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<Diagnostic>,
    getConfigFileParsingDiagnostics(): $ReadOnlyArray<Diagnostic>,
    getSyntacticDiagnostics(
      sourceFile?: SourceFile,
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<Diagnostic>,
    getDeclarationDiagnostics(
      sourceFile?: SourceFile,
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<DiagnosticWithLocation>,
    getAllDependencies(sourceFile: SourceFile): $ReadOnlyArray<string>,
    getSemanticDiagnostics(
      sourceFile?: SourceFile,
      cancellationToken?: CancellationToken
    ): $ReadOnlyArray<Diagnostic>,
    emit(
      targetSourceFile?: SourceFile,
      writeFile?: WriteFileCallback,
      cancellationToken?: CancellationToken,
      emitOnlyDtsFiles?: boolean,
      customTransformers?: CustomTransformers
    ): EmitResult,
    getCurrentDirectory(): string,
    ...
  };

  declare type SemanticDiagnosticsBuilderProgram = {
    ...$Exact<BuilderProgram>,
    getSemanticDiagnosticsOfNextAffectedFile(
      cancellationToken?: CancellationToken,
      ignoreSourceFile?: (sourceFile: SourceFile) => boolean
    ): AffectedFileResult<$ReadOnlyArray<Diagnostic>>,
    ...
  };

  declare type EmitAndSemanticDiagnosticsBuilderProgram = {
    ...$Exact<BuilderProgram>,
    emitNextAffectedFile(
      writeFile?: WriteFileCallback,
      cancellationToken?: CancellationToken,
      emitOnlyDtsFiles?: boolean,
      customTransformers?: CustomTransformers
    ): AffectedFileResult<EmitResult>,
    ...
  };

  declare function createSemanticDiagnosticsBuilderProgram(
    newProgram: Program,
    host: BuilderProgramHost,
    oldProgram?: SemanticDiagnosticsBuilderProgram,
    configFileParsingDiagnostics?: $ReadOnlyArray<Diagnostic>
  ): SemanticDiagnosticsBuilderProgram;

  declare function createSemanticDiagnosticsBuilderProgram(
    rootNames: $ReadOnlyArray<string> | void,
    options: CompilerOptions | void,
    host?: CompilerHost,
    oldProgram?: SemanticDiagnosticsBuilderProgram,
    configFileParsingDiagnostics?: $ReadOnlyArray<Diagnostic>,
    projectReferences?: $ReadOnlyArray<ProjectReference>
  ): SemanticDiagnosticsBuilderProgram;

  declare function createEmitAndSemanticDiagnosticsBuilderProgram(
    newProgram: Program,
    host: BuilderProgramHost,
    oldProgram?: EmitAndSemanticDiagnosticsBuilderProgram,
    configFileParsingDiagnostics?: $ReadOnlyArray<Diagnostic>
  ): EmitAndSemanticDiagnosticsBuilderProgram;

  declare function createEmitAndSemanticDiagnosticsBuilderProgram(
    rootNames: $ReadOnlyArray<string> | void,
    options: CompilerOptions | void,
    host?: CompilerHost,
    oldProgram?: EmitAndSemanticDiagnosticsBuilderProgram,
    configFileParsingDiagnostics?: $ReadOnlyArray<Diagnostic>,
    projectReferences?: $ReadOnlyArray<ProjectReference>
  ): EmitAndSemanticDiagnosticsBuilderProgram;

  declare function createAbstractBuilder(
    newProgram: Program,
    host: BuilderProgramHost,
    oldProgram?: BuilderProgram,
    configFileParsingDiagnostics?: $ReadOnlyArray<Diagnostic>
  ): BuilderProgram;

  declare function createAbstractBuilder(
    rootNames: $ReadOnlyArray<string> | void,
    options: CompilerOptions | void,
    host?: CompilerHost,
    oldProgram?: BuilderProgram,
    configFileParsingDiagnostics?: $ReadOnlyArray<Diagnostic>,
    projectReferences?: $ReadOnlyArray<ProjectReference>
  ): BuilderProgram;

  declare type WatchStatusReporter = (
    diagnostic: Diagnostic,
    newLine: string,
    options: CompilerOptions
  ) => void;
  declare type CreateProgram<T: BuilderProgram> = (
    rootNames: $ReadOnlyArray<string> | void,
    options: CompilerOptions | void,
    host?: CompilerHost,
    oldProgram?: T,
    configFileParsingDiagnostics?: $ReadOnlyArray<Diagnostic>,
    projectReferences?: $ReadOnlyArray<ProjectReference> | void
  ) => T;
  declare type WatchHost = {
    onWatchStatusChange?: (
      diagnostic: Diagnostic,
      newLine: string,
      options: CompilerOptions
    ) => void,
    watchFile(
      path: string,
      callback: FileWatcherCallback,
      pollingInterval?: number
    ): FileWatcher,
    watchDirectory(
      path: string,
      callback: DirectoryWatcherCallback,
      recursive?: boolean
    ): FileWatcher,
    setTimeout?: (
      callback: (...args: any[]) => void,
      ms: number,
      ...args: any[]
    ) => any,
    clearTimeout?: (timeoutId: any) => void,
    ...
  };

  declare type ProgramHost<T: BuilderProgram> = {
    createProgram: CreateProgram<T>,
    useCaseSensitiveFileNames(): boolean,
    getNewLine(): string,
    getCurrentDirectory(): string,
    getDefaultLibFileName(options: CompilerOptions): string,
    getDefaultLibLocation?: () => string,
    createHash?: (data: string) => string,
    fileExists(path: string): boolean,
    readFile(path: string, encoding?: string): string | void,
    directoryExists?: (path: string) => boolean,
    getDirectories?: (path: string) => string[],
    readDirectory?: (
      path: string,
      extensions?: $ReadOnlyArray<string>,
      exclude?: $ReadOnlyArray<string>,
      include?: $ReadOnlyArray<string>,
      depth?: number
    ) => string[],
    realpath?: (path: string) => string,
    trace?: (s: string) => void,
    getEnvironmentVariable?: (name: string) => string | void,
    resolveModuleNames?: (
      moduleNames: string[],
      containingFile: string,
      reusedNames?: string[],
      redirectedReference?: ResolvedProjectReference
    ) => (ResolvedModule | void)[],
    resolveTypeReferenceDirectives?: (
      typeReferenceDirectiveNames: string[],
      containingFile: string,
      redirectedReference?: ResolvedProjectReference
    ) => (ResolvedTypeReferenceDirective | void)[],
    ...
  };

  declare type WatchCompilerHost<T: BuilderProgram> = {
    ...$Exact<ProgramHost<T>>,
    ...$Exact<WatchHost>,
    afterProgramCreate?: (program: T) => void,
    ...
  };

  declare type WatchCompilerHostOfFilesAndCompilerOptions<T: BuilderProgram> = {
    ...$Exact<WatchCompilerHost<T>>,
    rootFiles: string[],
    options: CompilerOptions,
    projectReferences?: $ReadOnlyArray<ProjectReference>,
    ...
  };

  declare type WatchCompilerHostOfConfigFile<T: BuilderProgram> = {
    ...$Exact<WatchCompilerHost<T>>,
    ...$Exact<ConfigFileDiagnosticsReporter>,
    configFileName: string,
    optionsToExtend?: CompilerOptions,
    readDirectory(
      path: string,
      extensions?: $ReadOnlyArray<string>,
      exclude?: $ReadOnlyArray<string>,
      include?: $ReadOnlyArray<string>,
      depth?: number
    ): string[],
    ...
  };

  declare type Watch<T> = { getProgram(): T, ... };

  declare type WatchOfConfigFile<T> = { ...$Exact<Watch<T>>, ... };

  declare type WatchOfFilesAndCompilerOptions<T> = {
    ...$Exact<Watch<T>>,
    updateRootFileNames(fileNames: string[]): void,
    ...
  };

  declare function createWatchCompilerHost<T: BuilderProgram>(
    configFileName: string,
    optionsToExtend: CompilerOptions | void,
    system: System,
    createProgram?: CreateProgram<T>,
    reportDiagnostic?: DiagnosticReporter,
    reportWatchStatus?: WatchStatusReporter
  ): WatchCompilerHostOfConfigFile<T>;

  declare function createWatchCompilerHost<T: BuilderProgram>(
    rootFiles: string[],
    options: CompilerOptions,
    system: System,
    createProgram?: CreateProgram<T>,
    reportDiagnostic?: DiagnosticReporter,
    reportWatchStatus?: WatchStatusReporter,
    projectReferences?: $ReadOnlyArray<ProjectReference>
  ): WatchCompilerHostOfFilesAndCompilerOptions<T>;

  declare function createWatchProgram<T: BuilderProgram>(
    host: WatchCompilerHostOfFilesAndCompilerOptions<T>
  ): WatchOfFilesAndCompilerOptions<T>;

  declare function createWatchProgram<T: BuilderProgram>(
    host: WatchCompilerHostOfConfigFile<T>
  ): WatchOfConfigFile<T>;

  declare type SourceFileLike = { getLineAndCharacterOfPosition(pos: number): LineAndCharacter, ... };

  declare type IScriptSnapshot = {
    getText(start: number, end: number): string,
    getLength(): number,
    getChangeRange(oldSnapshot: IScriptSnapshot): TextChangeRange | void,
    dispose?: () => void,
    ...
  };

  declare function ScriptSnapshot$fromString(text: string): IScriptSnapshot;

  declare type PreProcessedFileInfo = {
    referencedFiles: FileReference[],
    typeReferenceDirectives: FileReference[],
    libReferenceDirectives: FileReference[],
    importedFiles: FileReference[],
    ambientExternalModules?: string[],
    isLibFile: boolean,
    ...
  };

  declare type HostCancellationToken = { isCancellationRequested(): boolean, ... };

  declare type InstallPackageOptions = {
    fileName: Path,
    packageName: string,
    ...
  };

  declare type LanguageServiceHost = {
    ...$Exact<GetEffectiveTypeRootsHost>,
    getCompilationSettings(): CompilerOptions,
    getNewLine?: () => string,
    getProjectVersion?: () => string,
    getScriptFileNames(): string[],
    getScriptKind?: (fileName: string) => $Values<typeof ScriptKind>,
    getScriptVersion(fileName: string): string,
    getScriptSnapshot(fileName: string): IScriptSnapshot | void,
    getProjectReferences?: () => $ReadOnlyArray<ProjectReference> | void,
    getLocalizedDiagnosticMessages?: () => any,
    getCancellationToken?: () => HostCancellationToken,
    getCurrentDirectory(): string,
    getDefaultLibFileName(options: CompilerOptions): string,
    log?: (s: string) => void,
    trace?: (s: string) => void,
    error?: (s: string) => void,
    useCaseSensitiveFileNames?: () => boolean,
    readDirectory?: (
      path: string,
      extensions?: $ReadOnlyArray<string>,
      exclude?: $ReadOnlyArray<string>,
      include?: $ReadOnlyArray<string>,
      depth?: number
    ) => string[],
    readFile?: (path: string, encoding?: string) => string | void,
    realpath?: (path: string) => string,
    fileExists?: (path: string) => boolean,
    getTypeRootsVersion?: () => number,
    resolveModuleNames?: (
      moduleNames: string[],
      containingFile: string,
      reusedNames?: string[],
      redirectedReference?: ResolvedProjectReference
    ) => (ResolvedModule | void)[],
    getResolvedModuleWithFailedLookupLocationsFromCache?: (
      modulename: string,
      containingFile: string
    ) => ResolvedModuleWithFailedLookupLocations | void,
    resolveTypeReferenceDirectives?: (
      typeDirectiveNames: string[],
      containingFile: string,
      redirectedReference?: ResolvedProjectReference
    ) => (ResolvedTypeReferenceDirective | void)[],
    getDirectories?: (directoryName: string) => string[],
    getCustomTransformers?: () => CustomTransformers | void,
    isKnownTypesPackageName?: (name: string) => boolean,
    installPackage?: (
      options: InstallPackageOptions
    ) => Promise<ApplyCodeActionCommandResult>,
    writeFile?: (fileName: string, content: string) => void,
    ...
  };

  declare type WithMetadata<T> = T & { metadata?: mixed, ... };
  declare type LanguageService = {
    cleanupSemanticCache(): void,
    getSyntacticDiagnostics(fileName: string): DiagnosticWithLocation[],
    getSemanticDiagnostics(fileName: string): Diagnostic[],
    getSuggestionDiagnostics(fileName: string): DiagnosticWithLocation[],
    getCompilerOptionsDiagnostics(): Diagnostic[],
    getSyntacticClassifications(
      fileName: string,
      span: TextSpan
    ): ClassifiedSpan[],
    getSemanticClassifications(
      fileName: string,
      span: TextSpan
    ): ClassifiedSpan[],
    getEncodedSyntacticClassifications(
      fileName: string,
      span: TextSpan
    ): Classifications,
    getEncodedSemanticClassifications(
      fileName: string,
      span: TextSpan
    ): Classifications,
    getCompletionsAtPosition(
      fileName: string,
      position: number,
      options: GetCompletionsAtPositionOptions | void
    ): WithMetadata<CompletionInfo> | void,
    getCompletionEntryDetails(
      fileName: string,
      position: number,
      name: string,
      formatOptions: FormatCodeOptions | FormatCodeSettings | void,
      source: string | void,
      preferences: UserPreferences | void
    ): CompletionEntryDetails | void,
    getCompletionEntrySymbol(
      fileName: string,
      position: number,
      name: string,
      source: string | void
    ): Symbol | void,
    getQuickInfoAtPosition(
      fileName: string,
      position: number
    ): QuickInfo | void,
    getNameOrDottedNameSpan(
      fileName: string,
      startPos: number,
      endPos: number
    ): TextSpan | void,
    getBreakpointStatementAtPosition(
      fileName: string,
      position: number
    ): TextSpan | void,
    getSignatureHelpItems(
      fileName: string,
      position: number,
      options: SignatureHelpItemsOptions | void
    ): SignatureHelpItems | void,
    getRenameInfo(
      fileName: string,
      position: number,
      options?: RenameInfoOptions
    ): RenameInfo,
    findRenameLocations(
      fileName: string,
      position: number,
      findInStrings: boolean,
      findInComments: boolean,
      providePrefixAndSuffixTextForRename?: boolean
    ): $ReadOnlyArray<RenameLocation> | void,
    getDefinitionAtPosition(
      fileName: string,
      position: number
    ): $ReadOnlyArray<DefinitionInfo> | void,
    getDefinitionAndBoundSpan(
      fileName: string,
      position: number
    ): DefinitionInfoAndBoundSpan | void,
    getTypeDefinitionAtPosition(
      fileName: string,
      position: number
    ): $ReadOnlyArray<DefinitionInfo> | void,
    getImplementationAtPosition(
      fileName: string,
      position: number
    ): $ReadOnlyArray<ImplementationLocation> | void,
    getReferencesAtPosition(
      fileName: string,
      position: number
    ): ReferenceEntry[] | void,
    findReferences(
      fileName: string,
      position: number
    ): ReferencedSymbol[] | void,
    getDocumentHighlights(
      fileName: string,
      position: number,
      filesToSearch: string[]
    ): DocumentHighlights[] | void,
    getOccurrencesAtPosition(
      fileName: string,
      position: number
    ): $ReadOnlyArray<ReferenceEntry> | void,
    getNavigateToItems(
      searchValue: string,
      maxResultCount?: number,
      fileName?: string,
      excludeDtsFiles?: boolean
    ): NavigateToItem[],
    getNavigationBarItems(fileName: string): NavigationBarItem[],
    getNavigationTree(fileName: string): NavigationTree,
    getOutliningSpans(fileName: string): OutliningSpan[],
    getTodoComments(
      fileName: string,
      descriptors: TodoCommentDescriptor[]
    ): TodoComment[],
    getBraceMatchingAtPosition(fileName: string, position: number): TextSpan[],
    getIndentationAtPosition(
      fileName: string,
      position: number,
      options: EditorOptions | EditorSettings
    ): number,
    getFormattingEditsForRange(
      fileName: string,
      start: number,
      end: number,
      options: FormatCodeOptions | FormatCodeSettings
    ): TextChange[],
    getFormattingEditsForDocument(
      fileName: string,
      options: FormatCodeOptions | FormatCodeSettings
    ): TextChange[],
    getFormattingEditsAfterKeystroke(
      fileName: string,
      position: number,
      key: string,
      options: FormatCodeOptions | FormatCodeSettings
    ): TextChange[],
    getDocCommentTemplateAtPosition(
      fileName: string,
      position: number
    ): TextInsertion | void,
    isValidBraceCompletionAtPosition(
      fileName: string,
      position: number,
      openingBrace: number
    ): boolean,
    getJsxClosingTagAtPosition(
      fileName: string,
      position: number
    ): JsxClosingTagInfo | void,
    getSpanOfEnclosingComment(
      fileName: string,
      position: number,
      onlyMultiLine: boolean
    ): TextSpan | void,
    toLineColumnOffset?: (
      fileName: string,
      position: number
    ) => LineAndCharacter,
    getCodeFixesAtPosition(
      fileName: string,
      start: number,
      end: number,
      errorCodes: $ReadOnlyArray<number>,
      formatOptions: FormatCodeSettings,
      preferences: UserPreferences
    ): $ReadOnlyArray<CodeFixAction>,
    getCombinedCodeFix(
      scope: CombinedCodeFixScope,
      fixId: {...},
      formatOptions: FormatCodeSettings,
      preferences: UserPreferences
    ): CombinedCodeActions,
    applyCodeActionCommand(
      action: CodeActionCommand,
      formatSettings?: FormatCodeSettings
    ): Promise<ApplyCodeActionCommandResult>,
    applyCodeActionCommand(
      action: CodeActionCommand[],
      formatSettings?: FormatCodeSettings
    ): Promise<ApplyCodeActionCommandResult[]>,
    applyCodeActionCommand(
      action: CodeActionCommand | CodeActionCommand[],
      formatSettings?: FormatCodeSettings
    ): Promise<ApplyCodeActionCommandResult | ApplyCodeActionCommandResult[]>,
    applyCodeActionCommand(
      fileName: string,
      action: CodeActionCommand
    ): Promise<ApplyCodeActionCommandResult>,
    applyCodeActionCommand(
      fileName: string,
      action: CodeActionCommand[]
    ): Promise<ApplyCodeActionCommandResult[]>,
    applyCodeActionCommand(
      fileName: string,
      action: CodeActionCommand | CodeActionCommand[]
    ): Promise<ApplyCodeActionCommandResult | ApplyCodeActionCommandResult[]>,
    getApplicableRefactors(
      fileName: string,
      positionOrRange: number | TextRange,
      preferences: UserPreferences | void
    ): ApplicableRefactorInfo[],
    getEditsForRefactor(
      fileName: string,
      formatOptions: FormatCodeSettings,
      positionOrRange: number | TextRange,
      refactorName: string,
      actionName: string,
      preferences: UserPreferences | void
    ): RefactorEditInfo | void,
    organizeImports(
      scope: OrganizeImportsScope,
      formatOptions: FormatCodeSettings,
      preferences: UserPreferences | void
    ): $ReadOnlyArray<FileTextChanges>,
    getEditsForFileRename(
      oldFilePath: string,
      newFilePath: string,
      formatOptions: FormatCodeSettings,
      preferences: UserPreferences | void
    ): $ReadOnlyArray<FileTextChanges>,
    getEmitOutput(fileName: string, emitOnlyDtsFiles?: boolean): EmitOutput,
    getProgram(): Program | void,
    dispose(): void,
    ...
  };

  declare type JsxClosingTagInfo = { +newText: string, ... };

  declare type CombinedCodeFixScope = {
    type: "file",
    fileName: string,
    ...
  };

  declare type OrganizeImportsScope = CombinedCodeFixScope;
  declare type CompletionsTriggerCharacter =
    | "."
    | '"'
    | "'"
    | "`"
    | "/"
    | "@"
    | "<";
  declare type GetCompletionsAtPositionOptions = {
    ...$Exact<UserPreferences>,
    triggerCharacter?: CompletionsTriggerCharacter,
    includeExternalModuleExports?: boolean,
    includeInsertTextCompletions?: boolean,
    ...
  };

  declare type SignatureHelpTriggerCharacter = "," | "(" | "<";
  declare type SignatureHelpRetriggerCharacter =
    | SignatureHelpTriggerCharacter
    | ")";
  declare type SignatureHelpItemsOptions = { triggerReason?: SignatureHelpTriggerReason, ... };

  declare type SignatureHelpTriggerReason =
    | SignatureHelpInvokedReason
    | SignatureHelpCharacterTypedReason
    | SignatureHelpRetriggeredReason;
  declare type SignatureHelpInvokedReason = {
    kind: "invoked",
    triggerCharacter?: void,
    ...
  };

  declare type SignatureHelpCharacterTypedReason = {
    kind: "characterTyped",
    triggerCharacter: SignatureHelpTriggerCharacter,
    ...
  };

  declare type SignatureHelpRetriggeredReason = {
    kind: "retrigger",
    triggerCharacter?: SignatureHelpRetriggerCharacter,
    ...
  };

  declare type ApplyCodeActionCommandResult = { successMessage: string, ... };

  declare type Classifications = {
    spans: number[],
    endOfLineState: $Values<typeof EndOfLineState>,
    ...
  };

  declare type ClassifiedSpan = {
    textSpan: TextSpan,
    classificationType: $Values<typeof ClassificationTypeNames>,
    ...
  };

  declare type NavigationBarItem = {
    text: string,
    kind: $Values<typeof ScriptElementKind>,
    kindModifiers: string,
    spans: TextSpan[],
    childItems: NavigationBarItem[],
    indent: number,
    bolded: boolean,
    grayed: boolean,
    ...
  };

  declare type NavigationTree = {
    text: string,
    kind: $Values<typeof ScriptElementKind>,
    kindModifiers: string,
    spans: TextSpan[],
    nameSpan: TextSpan | void,
    childItems?: NavigationTree[],
    ...
  };

  declare type TodoCommentDescriptor = {
    text: string,
    priority: number,
    ...
  };

  declare type TodoComment = {
    descriptor: TodoCommentDescriptor,
    message: string,
    position: number,
    ...
  };

  declare type TextChange = {
    span: TextSpan,
    newText: string,
    ...
  };

  declare type FileTextChanges = {
    fileName: string,
    textChanges: TextChange[],
    isNewFile?: boolean,
    ...
  };

  declare type CodeAction = {
    description: string,
    changes: FileTextChanges[],
    commands?: CodeActionCommand[],
    ...
  };

  declare type CodeFixAction = {
    ...$Exact<CodeAction>,
    fixName: string,
    fixId?: {...},
    fixAllDescription?: string,
    ...
  };

  declare type CombinedCodeActions = {
    changes: $ReadOnlyArray<FileTextChanges>,
    commands?: $ReadOnlyArray<CodeActionCommand>,
    ...
  };

  declare type CodeActionCommand = InstallPackageAction | GenerateTypesAction;
  declare type InstallPackageAction = {...};

  declare type GenerateTypesAction = { ...$Exact<GenerateTypesOptions>, ... };

  declare type GenerateTypesOptions = {
    +file: string,
    +fileToGenerateTypesFor: string,
    +outputFileName: string,
    ...
  };

  declare type ApplicableRefactorInfo = {
    name: string,
    description: string,
    inlineable?: boolean,
    actions: RefactorActionInfo[],
    ...
  };

  declare type RefactorActionInfo = {
    name: string,
    description: string,
    ...
  };

  declare type RefactorEditInfo = {
    edits: FileTextChanges[],
    renameFilename?: string,
    renameLocation?: number,
    commands?: CodeActionCommand[],
    ...
  };

  declare type TextInsertion = {
    newText: string,
    caretOffset: number,
    ...
  };

  declare type DocumentSpan = {
    textSpan: TextSpan,
    fileName: string,
    originalTextSpan?: TextSpan,
    originalFileName?: string,
    ...
  };

  declare type RenameLocation = {
    ...$Exact<DocumentSpan>,
    +prefixText?: string,
    +suffixText?: string,
    ...
  };

  declare type ReferenceEntry = {
    ...$Exact<DocumentSpan>,
    isWriteAccess: boolean,
    isDefinition: boolean,
    isInString?: true,
    ...
  };

  declare type ImplementationLocation = {
    ...$Exact<DocumentSpan>,
    kind: $Values<typeof ScriptElementKind>,
    displayParts: SymbolDisplayPart[],
    ...
  };

  declare type DocumentHighlights = {
    fileName: string,
    highlightSpans: HighlightSpan[],
    ...
  };

  declare var HighlightSpanKind: {
    // "none"
    +none: "none",
    // "definition"
    +definition: "definition",
    // "reference"
    +reference: "reference",
    // "writtenReference"
    +writtenReference: "writtenReference",
    ...
  };

  declare type HighlightSpan = {
    fileName?: string,
    isInString?: true,
    textSpan: TextSpan,
    kind: $Values<typeof HighlightSpanKind>,
    ...
  };

  declare type NavigateToItem = {
    name: string,
    kind: $Values<typeof ScriptElementKind>,
    kindModifiers: string,
    matchKind: "exact" | "prefix" | "substring" | "camelCase",
    isCaseSensitive: boolean,
    fileName: string,
    textSpan: TextSpan,
    containerName: string,
    containerKind: $Values<typeof ScriptElementKind>,
    ...
  };

  declare var IndentStyle: {
    // 0
    +None: 0,
    // 1
    +Block: 1,
    // 2
    +Smart: 2,
    ...
  };

  declare type EditorOptions = {
    BaseIndentSize?: number,
    IndentSize: number,
    TabSize: number,
    NewLineCharacter: string,
    ConvertTabsToSpaces: boolean,
    IndentStyle: $Values<typeof IndentStyle>,
    ...
  };

  declare type EditorSettings = {
    baseIndentSize?: number,
    indentSize?: number,
    tabSize?: number,
    newLineCharacter?: string,
    convertTabsToSpaces?: boolean,
    indentStyle?: $Values<typeof IndentStyle>,
    ...
  };

  declare type FormatCodeOptions = {
    ...$Exact<EditorOptions>,
    InsertSpaceAfterCommaDelimiter: boolean,
    InsertSpaceAfterSemicolonInForStatements: boolean,
    InsertSpaceBeforeAndAfterBinaryOperators: boolean,
    InsertSpaceAfterConstructor?: boolean,
    InsertSpaceAfterKeywordsInControlFlowStatements: boolean,
    InsertSpaceAfterFunctionKeywordForAnonymousFunctions: boolean,
    InsertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: boolean,
    InsertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: boolean,
    InsertSpaceAfterOpeningAndBeforeClosingNonemptyBraces?: boolean,
    InsertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: boolean,
    InsertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces?: boolean,
    InsertSpaceAfterTypeAssertion?: boolean,
    InsertSpaceBeforeFunctionParenthesis?: boolean,
    PlaceOpenBraceOnNewLineForFunctions: boolean,
    PlaceOpenBraceOnNewLineForControlBlocks: boolean,
    insertSpaceBeforeTypeAnnotation?: boolean,
    ...
  };

  declare type FormatCodeSettings = {
    ...$Exact<EditorSettings>,
    +insertSpaceAfterCommaDelimiter?: boolean,
    +insertSpaceAfterSemicolonInForStatements?: boolean,
    +insertSpaceBeforeAndAfterBinaryOperators?: boolean,
    +insertSpaceAfterConstructor?: boolean,
    +insertSpaceAfterKeywordsInControlFlowStatements?: boolean,
    +insertSpaceAfterFunctionKeywordForAnonymousFunctions?: boolean,
    +insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis?: boolean,
    +insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets?: boolean,
    +insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces?: boolean,
    +insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces?: boolean,
    +insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces?: boolean,
    +insertSpaceAfterTypeAssertion?: boolean,
    +insertSpaceBeforeFunctionParenthesis?: boolean,
    +placeOpenBraceOnNewLineForFunctions?: boolean,
    +placeOpenBraceOnNewLineForControlBlocks?: boolean,
    +insertSpaceBeforeTypeAnnotation?: boolean,
    +indentMultiLineObjectLiteralBeginningOnBlankLine?: boolean,
    ...
  };

  declare function getDefaultFormatCodeSettings(
    newLineCharacter?: string
  ): FormatCodeSettings;

  declare type DefinitionInfo = {
    ...$Exact<DocumentSpan>,
    kind: $Values<typeof ScriptElementKind>,
    name: string,
    containerKind: $Values<typeof ScriptElementKind>,
    containerName: string,
    ...
  };

  declare type DefinitionInfoAndBoundSpan = {
    definitions?: $ReadOnlyArray<DefinitionInfo>,
    textSpan: TextSpan,
    ...
  };

  declare type ReferencedSymbolDefinitionInfo = {
    ...$Exact<DefinitionInfo>,
    displayParts: SymbolDisplayPart[],
    ...
  };

  declare type ReferencedSymbol = {
    definition: ReferencedSymbolDefinitionInfo,
    references: ReferenceEntry[],
    ...
  };

  declare var SymbolDisplayPartKind: {
    // 0
    +aliasName: 0,
    // 1
    +className: 1,
    // 2
    +enumName: 2,
    // 3
    +fieldName: 3,
    // 4
    +interfaceName: 4,
    // 5
    +keyword: 5,
    // 6
    +lineBreak: 6,
    // 7
    +numericLiteral: 7,
    // 8
    +stringLiteral: 8,
    // 9
    +localName: 9,
    // 10
    +methodName: 10,
    // 11
    +moduleName: 11,
    // 12
    +operator: 12,
    // 13
    +parameterName: 13,
    // 14
    +propertyName: 14,
    // 15
    +punctuation: 15,
    // 16
    +space: 16,
    // 17
    +text: 17,
    // 18
    +typeParameterName: 18,
    // 19
    +enumMemberName: 19,
    // 20
    +functionName: 20,
    // 21
    +regularExpressionLiteral: 21,
    ...
  };

  declare type SymbolDisplayPart = {
    text: string,
    kind: string,
    ...
  };

  declare type JSDocTagInfo = {
    name: string,
    text?: string,
    ...
  };

  declare type QuickInfo = {
    kind: $Values<typeof ScriptElementKind>,
    kindModifiers: string,
    textSpan: TextSpan,
    displayParts?: SymbolDisplayPart[],
    documentation?: SymbolDisplayPart[],
    tags?: JSDocTagInfo[],
    ...
  };

  declare type RenameInfo = RenameInfoSuccess | RenameInfoFailure;
  declare type RenameInfoSuccess = {
    canRename: true,
    fileToRename?: string,
    displayName: string,
    fullDisplayName: string,
    kind: $Values<typeof ScriptElementKind>,
    kindModifiers: string,
    triggerSpan: TextSpan,
    ...
  };

  declare type RenameInfoFailure = {
    canRename: false,
    localizedErrorMessage: string,
    ...
  };

  declare type RenameInfoOptions = { +allowRenameOfImportPath?: boolean, ... };

  declare type SignatureHelpParameter = {
    name: string,
    documentation: SymbolDisplayPart[],
    displayParts: SymbolDisplayPart[],
    isOptional: boolean,
    ...
  };

  declare type SignatureHelpItem = {
    isVariadic: boolean,
    prefixDisplayParts: SymbolDisplayPart[],
    suffixDisplayParts: SymbolDisplayPart[],
    separatorDisplayParts: SymbolDisplayPart[],
    parameters: SignatureHelpParameter[],
    documentation: SymbolDisplayPart[],
    tags: JSDocTagInfo[],
    ...
  };

  declare type SignatureHelpItems = {
    items: SignatureHelpItem[],
    applicableSpan: TextSpan,
    selectedItemIndex: number,
    argumentIndex: number,
    argumentCount: number,
    ...
  };

  declare type CompletionInfo = {
    isGlobalCompletion: boolean,
    isMemberCompletion: boolean,
    isNewIdentifierLocation: boolean,
    entries: CompletionEntry[],
    ...
  };

  declare type CompletionEntry = {
    name: string,
    kind: $Values<typeof ScriptElementKind>,
    kindModifiers?: string,
    sortText: string,
    insertText?: string,
    replacementSpan?: TextSpan,
    hasAction?: true,
    source?: string,
    isRecommended?: true,
    ...
  };

  declare type CompletionEntryDetails = {
    name: string,
    kind: $Values<typeof ScriptElementKind>,
    kindModifiers: string,
    displayParts: SymbolDisplayPart[],
    documentation?: SymbolDisplayPart[],
    tags?: JSDocTagInfo[],
    codeActions?: CodeAction[],
    source?: SymbolDisplayPart[],
    ...
  };

  declare type OutliningSpan = {
    textSpan: TextSpan,
    hintSpan: TextSpan,
    bannerText: string,
    autoCollapse: boolean,
    kind: $Values<typeof OutliningSpanKind>,
    ...
  };

  declare var OutliningSpanKind: {
    // "comment"
    +Comment: "comment",
    // "region"
    +Region: "region",
    // "code"
    +Code: "code",
    // "imports"
    +Imports: "imports",
    ...
  };

  declare var OutputFileType: {
    // 0
    +JavaScript: 0,
    // 1
    +SourceMap: 1,
    // 2
    +Declaration: 2,
    ...
  };

  declare var EndOfLineState: {
    // 0
    +None: 0,
    // 1
    +InMultiLineCommentTrivia: 1,
    // 2
    +InSingleQuoteStringLiteral: 2,
    // 3
    +InDoubleQuoteStringLiteral: 3,
    // 4
    +InTemplateHeadOrNoSubstitutionTemplate: 4,
    // 5
    +InTemplateMiddleOrTail: 5,
    // 6
    +InTemplateSubstitutionPosition: 6,
    ...
  };

  declare var TokenClass: {
    // 0
    +Punctuation: 0,
    // 1
    +Keyword: 1,
    // 2
    +Operator: 2,
    // 3
    +Comment: 3,
    // 4
    +Whitespace: 4,
    // 5
    +Identifier: 5,
    // 6
    +NumberLiteral: 6,
    // 7
    +BigIntLiteral: 7,
    // 8
    +StringLiteral: 8,
    // 9
    +RegExpLiteral: 9,
    ...
  };

  declare type ClassificationResult = {
    finalLexState: $Values<typeof EndOfLineState>,
    entries: ClassificationInfo[],
    ...
  };

  declare type ClassificationInfo = {
    length: number,
    classification: $Values<typeof TokenClass>,
    ...
  };

  declare type Classifier = {
    getClassificationsForLine(
      text: string,
      lexState: $Values<typeof EndOfLineState>,
      syntacticClassifierAbsent: boolean
    ): ClassificationResult,
    getEncodedLexicalClassifications(
      text: string,
      endOfLineState: $Values<typeof EndOfLineState>,
      syntacticClassifierAbsent: boolean
    ): Classifications,
    ...
  };

  declare var ScriptElementKind: {
    // ""
    +unknown: "",
    // "warning"
    +warning: "warning",
    // "keyword"
    +keyword: "keyword",
    // "script"
    +scriptElement: "script",
    // "module"
    +moduleElement: "module",
    // "class"
    +classElement: "class",
    // "local class"
    +localClassElement: "local class",
    // "interface"
    +interfaceElement: "interface",
    // "type"
    +typeElement: "type",
    // "enum"
    +enumElement: "enum",
    // "enum member"
    +enumMemberElement: "enum member",
    // "var"
    +variableElement: "var",
    // "local var"
    +localVariableElement: "local var",
    // "function"
    +functionElement: "function",
    // "local function"
    +localFunctionElement: "local function",
    // "method"
    +memberFunctionElement: "method",
    // "getter"
    +memberGetAccessorElement: "getter",
    // "setter"
    +memberSetAccessorElement: "setter",
    // "property"
    +memberVariableElement: "property",
    // "constructor"
    +constructorImplementationElement: "constructor",
    // "call"
    +callSignatureElement: "call",
    // "index"
    +indexSignatureElement: "index",
    // "construct"
    +constructSignatureElement: "construct",
    // "parameter"
    +parameterElement: "parameter",
    // "type parameter"
    +typeParameterElement: "type parameter",
    // "primitive type"
    +primitiveType: "primitive type",
    // "label"
    +label: "label",
    // "alias"
    +alias: "alias",
    // "const"
    +constElement: "const",
    // "let"
    +letElement: "let",
    // "directory"
    +directory: "directory",
    // "external module name"
    +externalModuleName: "external module name",
    // "JSX attribute"
    +jsxAttribute: "JSX attribute",
    // "string"
    +string: "string",
    ...
  };

  declare var ScriptElementKindModifier: {
    // ""
    +none: "",
    // "public"
    +publicMemberModifier: "public",
    // "private"
    +privateMemberModifier: "private",
    // "protected"
    +protectedMemberModifier: "protected",
    // "export"
    +exportedModifier: "export",
    // "declare"
    +ambientModifier: "declare",
    // "static"
    +staticModifier: "static",
    // "abstract"
    +abstractModifier: "abstract",
    // "optional"
    +optionalModifier: "optional",
    // ".d.ts"
    +dtsModifier: ".d.ts",
    // ".ts"
    +tsModifier: ".ts",
    // ".tsx"
    +tsxModifier: ".tsx",
    // ".js"
    +jsModifier: ".js",
    // ".jsx"
    +jsxModifier: ".jsx",
    // ".json"
    +jsonModifier: ".json",
    ...
  };

  declare var ClassificationTypeNames: {
    // "comment"
    +comment: "comment",
    // "identifier"
    +identifier: "identifier",
    // "keyword"
    +keyword: "keyword",
    // "number"
    +numericLiteral: "number",
    // "bigint"
    +bigintLiteral: "bigint",
    // "operator"
    +operator: "operator",
    // "string"
    +stringLiteral: "string",
    // "whitespace"
    +whiteSpace: "whitespace",
    // "text"
    +text: "text",
    // "punctuation"
    +punctuation: "punctuation",
    // "class name"
    +className: "class name",
    // "enum name"
    +enumName: "enum name",
    // "interface name"
    +interfaceName: "interface name",
    // "module name"
    +moduleName: "module name",
    // "type parameter name"
    +typeParameterName: "type parameter name",
    // "type alias name"
    +typeAliasName: "type alias name",
    // "parameter name"
    +parameterName: "parameter name",
    // "doc comment tag name"
    +docCommentTagName: "doc comment tag name",
    // "jsx open tag name"
    +jsxOpenTagName: "jsx open tag name",
    // "jsx close tag name"
    +jsxCloseTagName: "jsx close tag name",
    // "jsx self closing tag name"
    +jsxSelfClosingTagName: "jsx self closing tag name",
    // "jsx attribute"
    +jsxAttribute: "jsx attribute",
    // "jsx text"
    +jsxText: "jsx text",
    // "jsx attribute string literal value"
    +jsxAttributeStringLiteralValue: "jsx attribute string literal value",
    ...
  };

  declare var ClassificationType: {
    // 1
    +comment: 1,
    // 2
    +identifier: 2,
    // 3
    +keyword: 3,
    // 4
    +numericLiteral: 4,
    // 5
    +operator: 5,
    // 6
    +stringLiteral: 6,
    // 7
    +regularExpressionLiteral: 7,
    // 8
    +whiteSpace: 8,
    // 9
    +text: 9,
    // 10
    +punctuation: 10,
    // 11
    +className: 11,
    // 12
    +enumName: 12,
    // 13
    +interfaceName: 13,
    // 14
    +moduleName: 14,
    // 15
    +typeParameterName: 15,
    // 16
    +typeAliasName: 16,
    // 17
    +parameterName: 17,
    // 18
    +docCommentTagName: 18,
    // 19
    +jsxOpenTagName: 19,
    // 20
    +jsxCloseTagName: 20,
    // 21
    +jsxSelfClosingTagName: 21,
    // 22
    +jsxAttribute: 22,
    // 23
    +jsxText: 23,
    // 24
    +jsxAttributeStringLiteralValue: 24,
    // 25
    +bigintLiteral: 25,
    ...
  };

  declare function createClassifier(): Classifier;

  declare type DocumentRegistry = {
    acquireDocument(
      fileName: string,
      compilationSettings: CompilerOptions,
      scriptSnapshot: IScriptSnapshot,
      version: string,
      scriptKind?: $Values<typeof ScriptKind>
    ): SourceFile,
    acquireDocumentWithKey(
      fileName: string,
      path: Path,
      compilationSettings: CompilerOptions,
      key: DocumentRegistryBucketKey,
      scriptSnapshot: IScriptSnapshot,
      version: string,
      scriptKind?: $Values<typeof ScriptKind>
    ): SourceFile,
    updateDocument(
      fileName: string,
      compilationSettings: CompilerOptions,
      scriptSnapshot: IScriptSnapshot,
      version: string,
      scriptKind?: $Values<typeof ScriptKind>
    ): SourceFile,
    updateDocumentWithKey(
      fileName: string,
      path: Path,
      compilationSettings: CompilerOptions,
      key: DocumentRegistryBucketKey,
      scriptSnapshot: IScriptSnapshot,
      version: string,
      scriptKind?: $Values<typeof ScriptKind>
    ): SourceFile,
    getKeyForCompilationSettings(
      settings: CompilerOptions
    ): DocumentRegistryBucketKey,
    releaseDocument(
      fileName: string,
      compilationSettings: CompilerOptions
    ): void,
    releaseDocumentWithKey(path: Path, key: DocumentRegistryBucketKey): void,
    reportStats(): string,
    ...
  };

  declare type DocumentRegistryBucketKey = string & { __bucketKey: any, ... };
  declare function createDocumentRegistry(
    useCaseSensitiveFileNames?: boolean,
    currentDirectory?: string
  ): DocumentRegistry;

  declare function preProcessFile(
    sourceText: string,
    readImportFiles?: boolean,
    detectJavaScriptImports?: boolean
  ): PreProcessedFileInfo;

  declare type TranspileOptions = {
    compilerOptions?: CompilerOptions,
    fileName?: string,
    reportDiagnostics?: boolean,
    moduleName?: string,
    renamedDependencies?: MapLike<string>,
    transformers?: CustomTransformers,
    ...
  };

  declare type TranspileOutput = {
    outputText: string,
    diagnostics?: Diagnostic[],
    sourceMapText?: string,
    ...
  };

  declare function transpileModule(
    input: string,
    transpileOptions: TranspileOptions
  ): TranspileOutput;

  declare function transpile(
    input: string,
    compilerOptions?: CompilerOptions,
    fileName?: string,
    diagnostics?: Diagnostic[],
    moduleName?: string
  ): string;

  declare function generateTypesForModule(
    name: string,
    moduleValue: mixed,
    formatSettings: FormatCodeSettings
  ): string;

  declare function generateTypesForGlobal(
    name: string,
    globalValue: mixed,
    formatSettings: FormatCodeSettings
  ): string;

  declare var servicesVersion: any; // "0.8";
  declare function toEditorSettings(
    options: EditorOptions | EditorSettings
  ): EditorSettings;

  declare function displayPartsToString(
    displayParts: SymbolDisplayPart[] | void
  ): string;

  declare function getDefaultCompilerOptions(): CompilerOptions;

  declare function getSupportedCodeFixes(): string[];

  declare function createLanguageServiceSourceFile(
    fileName: string,
    scriptSnapshot: IScriptSnapshot,
    scriptTarget: $Values<typeof ScriptTarget>,
    version: string,
    setNodeParents: boolean,
    scriptKind?: $Values<typeof ScriptKind>
  ): SourceFile;

  declare var disableIncrementalParsing: boolean;
  declare function updateLanguageServiceSourceFile(
    sourceFile: SourceFile,
    scriptSnapshot: IScriptSnapshot,
    version: string,
    textChangeRange: TextChangeRange | void,
    aggressiveChecks?: boolean
  ): SourceFile;

  declare function createLanguageService(
    host: LanguageServiceHost,
    documentRegistry?: DocumentRegistry,
    syntaxOnly?: boolean
  ): LanguageService;

  declare function getDefaultLibFilePath(options: CompilerOptions): string;

  declare function transform<T: Node>(
    source: T | T[],
    transformers: TransformerFactory<T>[],
    compilerOptions?: CompilerOptions
  ): TransformationResult<T>;
  declare type ActionSet = "action::set";
  declare type ActionInvalidate = "action::invalidate";
  declare type ActionPackageInstalled = "action::packageInstalled";
  declare type ActionValueInspected = "action::valueInspected";
  declare type EventTypesRegistry = "event::typesRegistry";
  declare type EventBeginInstallTypes = "event::beginInstallTypes";
  declare type EventEndInstallTypes = "event::endInstallTypes";
  declare type EventInitializationFailed = "event::initializationFailed";
  declare type TypingInstallerResponse = { +kind:
    | ActionSet
    | ActionInvalidate
    | EventTypesRegistry
    | ActionPackageInstalled
    | ActionValueInspected
    | EventBeginInstallTypes
    | EventEndInstallTypes
    | EventInitializationFailed, ... };

  declare type TypingInstallerRequestWithProjectName = { +projectName: string, ... };

  declare type DiscoverTypings = {
    ...$Exact<TypingInstallerRequestWithProjectName>,
    +fileNames: string[],
    +projectRootPath: Path,
    +compilerOptions: CompilerOptions,
    +typeAcquisition: TypeAcquisition,
    +unresolvedImports: SortedReadonlyArray<string>,
    +cachePath?: string,
    +kind: "discover",
    ...
  };

  declare type CloseProject = {
    ...$Exact<TypingInstallerRequestWithProjectName>,
    +kind: "closeProject",
    ...
  };

  declare type TypesRegistryRequest = { +kind: "typesRegistry", ... };

  declare type InstallPackageRequest = {
    ...$Exact<TypingInstallerRequestWithProjectName>,
    +kind: "installPackage",
    +fileName: Path,
    +packageName: string,
    +projectRootPath: Path,
    ...
  };

  declare type PackageInstalledResponse = {
    ...$Exact<ProjectResponse>,
    +kind: ActionPackageInstalled,
    +success: boolean,
    +message: string,
    ...
  };

  declare type InitializationFailedResponse = {
    ...$Exact<TypingInstallerResponse>,
    +kind: EventInitializationFailed,
    +message: string,
    ...
  };

  declare type ProjectResponse = {
    ...$Exact<TypingInstallerResponse>,
    +projectName: string,
    ...
  };

  declare type InvalidateCachedTypings = {
    ...$Exact<ProjectResponse>,
    +kind: ActionInvalidate,
    ...
  };

  declare type InstallTypes = {
    ...$Exact<ProjectResponse>,
    +kind: EventBeginInstallTypes | EventEndInstallTypes,
    +eventId: number,
    +typingsInstallerVersion: string,
    +packagesToInstall: $ReadOnlyArray<string>,
    ...
  };

  declare type BeginInstallTypes = {
    ...$Exact<InstallTypes>,
    +kind: EventBeginInstallTypes,
    ...
  };

  declare type EndInstallTypes = {
    ...$Exact<InstallTypes>,
    +kind: EventEndInstallTypes,
    +installSuccess: boolean,
    ...
  };

  declare type SetTypings = {
    ...$Exact<ProjectResponse>,
    +typeAcquisition: TypeAcquisition,
    +compilerOptions: CompilerOptions,
    +typings: string[],
    +unresolvedImports: SortedReadonlyArray<string>,
    +kind: ActionSet,
    ...
  };
}
