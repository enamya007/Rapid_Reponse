// Local, minimal stand-in for `Express.Multer.File` (P4 contract §"Décisions complémentaires",
// D2). `@types/multer` is NOT installed and `multer@2.2.0` (pulled in transitively via
// `@nestjs/platform-express`) does not ship its own type declarations, so `Express.Multer.File`
// does not compile in this project. `@UploadedFile()` is a plain `ParameterDecorator` (see
// `@nestjs/common`'s `route-params.decorator.d.ts`) — it does not itself constrain the handler
// parameter's type — so this interface only needs to describe the subset of the real multer
// `File` object this codebase actually reads.
export interface MulterFileLike {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}
