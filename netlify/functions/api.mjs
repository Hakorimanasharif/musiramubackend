import serverless from "serverless-http";
import app from "../../src/app.js";

const serve = serverless(app, { binary: ["application/pdf"] });
export const handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  return serve(event, context);
};
