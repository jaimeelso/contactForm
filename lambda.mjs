/*
 * Copyright (c) Jaime Elso de Blas (https://jaimeelso.com)
 * Follow me on twitter: @jaimeelso
 * Check out my Github: https://github.com/jaimeelso
 * This code is licensed under the MIT license.
 * Created on: 01/20/2023
*/

/**
 * HTTP requests use the global `fetch` built into the Node.js runtime (stable since
 * Node 18, no dependency needed).
*/

/**
 * @module @aws-sdk/client-sns
 * The AWS SDK v3 SNS client is used to interact with Amazon Simple Notification Service (SNS)
*/
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

/**
 * @module @aws-sdk/client-secrets-manager
 * The AWS SDK v3 Secrets Manager client is used to securely store and manage application secrets.
*/
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

/**
 * The region where the AWS services are hosted.
 * @type {string}
 * @const
 */
const REGION = 'eu-west-1';

/**
 * Turnstile private key
 * @type {(null|string)}
 */
let TURNSTILE_SECRET_KEY = null;

/**
 * Topic ARN
 * @type {(null|string)}
 */
let SNS_ARN = null;

/**
 * Specify the required fields for the Lambda function. "website" is intentionally not
 * required: it's a honeypot field that must stay empty for real users.
 * @type {Array <string>}
 * @const
 */
const REQUIRED_INPUTS = ['mail', 'subject', 'message', 'token'];

/**
 * Regular expression to check if the string is in the format of an email address
 * @type {RegExp}
 * @const
 */
const MAIL_REGEX = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

/**
 * Possible responses that the Lambda function can return.
 * @type {Object}
 * @const
 */
const SECRET_RETRIEVAL_ERROR = {
	statusCode: 500,
	body: JSON.stringify({
		success: false,
		errorCode: 'SECRET_RETRIEVAL_ERROR',
		message: 'Error retrieving secrets from Secrets Manager'
	})
};
const JSON_PARSE_ERROR = {
	statusCode: 400,
	body: JSON.stringify({
		success: false,
		errorCode: 'JSON_PARSE_ERROR',
		message: 'Invalid HTTPS body'
	})
};
const MISSING_INPUT_ERROR = {
	statusCode: 400,
	body: JSON.stringify({
		success: false,
		errorCode: 'MISSING_INPUT_ERROR',
		message: 'Not all fields requiered'
	})
};
const VERIFY_INPUT_ERROR = {
	statusCode: 400,
	body: JSON.stringify({
		success: false,
		errorCode: 'VERIFY_INPUT_ERROR',
		message: 'Invalid inputs'
	})
};
const TURNSTILE_CONNECTION_ERROR = {
	statusCode: 500,
	body: JSON.stringify({
		success: false,
		errorCode: 'TURNSTILE_CONNECTION_ERROR',
		message: 'Could not connect to Turnstile server'
	})
};
const TURNSTILE_VERIFY_ERROR = {
	statusCode: 500,
	body: JSON.stringify({
		success: false,
		errorCode: 'TURNSTILE_VERIFY_ERROR',
		message: 'Turnstile verify returned false'
	})
};
const SNS_PUBLISH_ERROR = {
	statusCode: 500,
	body: JSON.stringify({
		success: false,
		errorCode: 'SNS_PUBLISH_ERROR',
		message: 'Could not send the message to SNS topic'
	})
};
const FORM_SUBMITTED_SUCCESSFULLY = {
	statusCode: 200,
	body: JSON.stringify({
		success: true,
		message: 'Form submitted successfully'
	})
};

/**
 * Initializes the TURNSTILE_SECRET_KEY and SNS_ARN variables with the values retrieved from Secrets Manager.
 * @async
 */
const init = async () => {
	const secretsManager = new SecretsManagerClient({
		region: REGION
	});

	try {
		const secret = await secretsManager.send(new GetSecretValueCommand({ SecretId: 'SECRET_ID' })); // Raplace SECRET_ID with your secret ID
		const secrets = JSON.parse(secret.SecretString);

		TURNSTILE_SECRET_KEY = secrets.TURNSTILE_SECRET_KEY; // Raplace .TURNSTILE_SECRET_KEY with the Key of your secret
		SNS_ARN = secrets.SNS_ARN; // Raplace .SNS_ARN with the Key of your secret
	} catch (error) {
		console.log('Error: ' + error);
	}
};

await init();

/**
 * Validates and sanitizes the input fields for the Lambda function.
 *
 * @param {Object} input - The input fields to be validated.
 * @returns {(Object|Boolean)} - The cleaned input if validation passed or false if validation failed.
 */
export const validateInput = (input) => {
    // Verify if the input is an object
    if (typeof input !== 'object') {
        console.log('Invalid input, expected an object');
		return false;
    }

	// Confirm all the necessary fields have been provided
	for (let i = 0; i < REQUIRED_INPUTS.length; i++) {
		if (!input[REQUIRED_INPUTS[i]]) {
			console.log('Missing required field: ' + REQUIRED_INPUTS[i]);
			return false;
		}
	}

	// Verify if the email has a valid format
	if (!MAIL_REGEX.test(input.mail)) {
		console.log('Invalid email format');
		return false;
	}

	// Verify if the subject has a valid size
	if (input.subject.length < 4 || input.subject.length > 100) {
		console.log('Invalid subject size');
		return false;
	}

	// Verify if the message has a valid size
	if (input.message.length < 20 || input.message.length > 1000) {
		console.log('Invalid message size');
		return false;
	}

	// Sanitizes the value of inputs.
	input.mail = input.mail.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
	input.subject = input.subject.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
	input.message = input.message.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");

	return input;
};

/**
 * Connects to the Cloudflare Turnstile API and verifies the token received in the Lambda function.
 *
 * @param {String} token - The Turnstile token received in the form submission.
 * @returns {Boolean} - Returns true if the token is valid, false otherwise.
 * @throws {Error} - If invalid input or could not connect to the Turnstile server.
 */
export const verifyTurnstile = async (token) => {
    // Verify if the token is an string
	if (typeof token !== 'string') {
		console.log('Invalid input, expected a string.');
		throw new Error('Invalid input, expected a string.');
	}

	// Preparing the data for the request to the Turnstile API.
	const data = 'secret=' + TURNSTILE_SECRET_KEY + '&response=' + token;

	try {
		// Perform a POST request to the Turnstile API with the private key and the token received in the Lambda function.
		const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			body: data,
			headers: {
				"Content-Type": "application/x-www-form-urlencoded"
			}
		});

		const responseData = await response.json();

		return responseData.success;
	} catch (error) {
		// Throw an error if Lambda could not connect to the Turnstile server.
		throw new Error('Lambda could not connect to Turnstile server. ERROR: ' + error);
	}
};

/**
 * Checks whether the honeypot field was filled in. "website" is hidden off-screen in the
 * form and must stay empty for real users; a non-empty value marks the submission as spam.
 *
 * @param {Object} body - The parsed request body.
 * @returns {Boolean} - True if the honeypot field is filled in.
 */
export const isHoneypotFilled = (body) => Boolean(body && body.website);

/**
 * Publishes a message to a specified SNS topic
 * @param {String} mail The email address of the sender
 * @param {String} subject The subject of the message
 * @param {String} message The content of the message
 * @return {Promise} Resolves if the message is successfully published,
 *                   otherwise it rejects with an error
 */
const publishMessageToSNS = async (mail, subject, message) => {
    try {
        // Create an instance of the SNS client
        const sns = new SNSClient({
            region: REGION
        });

        // Construct the message to be published
        const snsMessage = {
			mail: mail,
			subject: subject,
			message: message
		};

        // Prepare the parameters for the SNS publish method
        const snsParams = {
            Subject: '[CONTACT_FORM]',
            Message: JSON.stringify(snsMessage),
            TopicArn: SNS_ARN
        };

        // Publish the message to the specified SNS topic
        const response = await sns.send(new PublishCommand(snsParams));

        return response;
    } catch (error) {
        // Reject the promise with the error if the message couldn't be published
        throw new Error('Error publishing message to SNS: ' + error);
    }
};

/**
 * AWS Lambda function that receives a contact form submission, verifies the Turnstile token,
 * and then sends the form data to an SNS topic.
 *
 * @param {Object} event - The event object passed to the Lambda function.
 * @returns {Object} - Returns a JSON object containing the success or failure of the form submission.
 */
export const handler = async (event) => {
	// Some Browsers send and options method request previus to send a post request to check CORS
	if (event.httpMethod === 'OPTIONS') return {statusCode: 200}

	// Check that the secrets have been retrieved.
	if (!TURNSTILE_SECRET_KEY || !SNS_ARN) {
		console.log(SECRET_RETRIEVAL_ERROR);
		return SECRET_RETRIEVAL_ERROR;
	}

	// Extract the HTTPS POST request body from the event.
	let body = undefined;
	try {
		body = JSON.parse(event.body);
	} catch (error) {
		console.log(JSON_PARSE_ERROR);
		console.log(error);
		return JSON_PARSE_ERROR;
	}

	// Honeypot: if filled, silently report success without verifying Turnstile or
	// publishing to SNS, so the bot doesn't learn it was caught.
	if (isHoneypotFilled(body)) {
		console.log('Honeypot field filled, discarding submission without publishing.');
		return FORM_SUBMITTED_SUCCESSFULLY;
	}

	// Validates and sanitizes the input values.
	body = validateInput(body);
	if(!body) {
		console.log(VERIFY_INPUT_ERROR);
		return VERIFY_INPUT_ERROR;
	}

	// Check if Turnstile validates the request.
	let success = false;
	try {
		success = await verifyTurnstile(body.token);
	} catch (error) {
		console.log(TURNSTILE_CONNECTION_ERROR);
		console.log(error);
		return TURNSTILE_CONNECTION_ERROR;
	}
	if(!success) {
		console.log(TURNSTILE_VERIFY_ERROR);
		return TURNSTILE_VERIFY_ERROR;
	}

	//Publish a new message to the SNS topic using the form data.
	try {
		const response = await publishMessageToSNS(body.mail, body.subject, body.message);
		console.log(response);
	} catch (error) {
		console.log(SNS_PUBLISH_ERROR);
		console.log(error);
		return SNS_PUBLISH_ERROR;
	}
	
	console.log(FORM_SUBMITTED_SUCCESSFULLY);
	return FORM_SUBMITTED_SUCCESSFULLY;
};
