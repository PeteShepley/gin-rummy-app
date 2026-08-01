# Gin Rummy API Service

This is a TypeScript-based API service for the Gin Rummy game, designed to be deployed to AWS Lambda via API Gateway.

## Getting Started

### Prerequisites
- Node.js 18+
- AWS Account and configured credentials
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) (`sam`) — for local development only
- [Docker](https://www.docker.com/) — required by `sam local start-api` to run the Lambda runtime locally

### Project Structure
- `src/handler.ts`: The main AWS Lambda handler.
- `template.yaml`: A **local-only** AWS SAM template used by `sam local start-api` to mirror the production HTTP API shape. It is never deployed — real infrastructure is owned by Terraform in [`../../infrastructure`](../../infrastructure).
- `tsconfig.json`: TypeScript configuration.

### Available Scripts
- `npm run build`: Bundles the service with `esbuild` into `dist/index.js`.
- `npm run start:local`: Builds the service, then runs `sam local start-api` to serve it locally.
- `npm test`: Runs tests (placeholder).

Deployment happens via CI (`.github/workflows/deploy-api.yml`), which builds the Lambda code and updates the function created by Terraform — there is no `deploy` script here.

## Architecture
This service uses:
- **AWS Lambda**: Serverless compute for the API logic.
- **AWS API Gateway (HTTP API)**: The interface for handling HTTP requests.
- **TypeScript**: For type-safe development.
- **esbuild**: For fast bundling and transpilation.
- **Terraform**: Owns the Lambda, IAM role, and API Gateway infrastructure (see [`../../infrastructure`](../../infrastructure)).
- **AWS SAM**: Used only as a local development aid (`sam local start-api`), not for deployment.
