import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event: ', event);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from Gin Rummy API!',
      input: event,
    }),
  };
};
