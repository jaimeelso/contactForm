/*
 * Copyright (c) Jaime Elso de Blas (https://jaimeelso.com)
 * Follow me on twitter: @jaimeelso
 * Check out my Github: https://github.com/jaimeelso
 * This code is licensed under the MIT license.
 * Created on: 01/20/2023
*/


/**
 * @module node-fetch
 * The 'node-fetch' library is used to perform HTTP requests
*/
import fetch from 'node-fetch';

/**
 * @module aws-sdk/clients/sns.js
 * The 'aws-sdk' library is used to interact with Amazon Simple Notification Service (SNS)
*/
import SNS from 'aws-sdk/clients/sns.js';

/**
 * @module aws-sdk/clients/secretsmanager.js
 * The 'aws-sdk' library is used to interact with Amazon Secrets Manager to securely store and manage application secrets.
*/
import SecretsManager from 'aws-sdk/clients/secretsmanager.js';

/**
 * The region where the AWS services are hosted.
 * @type {string}
 * @const
 */
const REGION = 'eu-west-1';

/**
 * reCAPTCHA private key
 * @type {(null|string)}
 */
let CAPTCHA_KEY = null;

/**
 * Topic ARN
 * @type {(null|string)}
 */
let SNS_ARN = null;

/**
 * Specify the required fields for the Lambda function.
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
const RECAPTCHA_CONNECTION_ERROR = {
	statusCode: 500,
	body: JSON.stringify({
		success: false,
		errorCode: 'RECAPTCHA_CONNECTION_ERROR',
		message: 'Could not connect to reCAPTCHA server'
	})
};
const RECAPTCHA_VERIFY_ERROR = {
	statusCode: 500,
	body: JSON.stringify({
		success: false,
		errorCode: 'RECAPTCHA_VERIFY_ERROR',
		message: 'reCAPTCHA verify returned false'
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
 * Initializes the CAPTCHA_KEY and SNS_ARN variables with the values retrieved from Secrets Manager.
 * @async
 */
const init = async () => {
	const secretsManager = new SecretsManager({
		region: REGION
	});
	
	try {
		const secret = await secretsManager.getSecretValue({ SecretId: 'SECRET_ID' }).promise(); // Raplace SECRET_ID with your secret ID
		const secrets = JSON.parse(secret.SecretString);
	
		CAPTCHA_KEY = secrets.CAPTCHA_KEY; // Raplace .CAPTCHA_KEY with the Key of your secret
		SNS_ARN = secrets.SNS_ARN; // Raplace .SNS_ARN with the Key of your secret
		console.log("CAPTCHA_KEY: " + CAPTCHA_KEY);
		console.log("SNS_ARN: " + SNS_ARN);
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
const validateInput = (input) => {
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
 * Connects to the reCAPTCHA API and verifies the token received in the Lambda function.
 * 
 * @param {String} token - The reCAPTCHA token received in the form submission.
 * @returns {Boolean} - Returns true if the token is valid, false otherwise.
 * @throws {Error} - If invalid input or could not connect to reCAPTCHA server.
 */
const verifyRecaptcha = async (token) => {
    // Verify if the token is an string
	if (typeof token !== 'string') {
		console.log('Invalid input, expected a string.');
		throw new Error('Invalid input, expected a string.');
	}

	// Preparing the data for the request to the reCAPTCHA API.
	const data = 'secret=' + CAPTCHA_KEY + '&response=' + token;

	try {
		// Perform a POST request to the reCAPTCHA API with the private key and the token received in the Lambda function.
		const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
			method: 'POST',
			body: data,
			headers: {
				"Content-Type": "application/x-www-form-urlencoded"
			}
		});
		
		const responseData = await response.json();

		console.log(responseData);

		return responseData.success;
	} catch (error) {
		// Throw an error if Lambda could not connect to reCAPTCHA server.
		throw new Error('Lambda could not connect to reCAPTCHA server. ERROR: ' + error);
	}
};

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
        const sns = new SNS({
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
        const response = await sns.publish(snsParams).promise();

        return response;
    } catch (error) {
        // Reject the promise with the error if the message couldn't be published
        throw new Error('Error publishing message to SNS: ' + error);
    }
};

/**
 * AWS Lambda function that receives a contact form submission, verifies the reCAPTCHA token, 
 * and then sends the form data to an SNS topic.
 * 
 * @param {Object} event - The event object passed to the Lambda function.
 * @returns {Object} - Returns a JSON object containing the success or failure of the form submission.
 */
export const handler = async (event) => {
	// Some Browsers send and options method request previus to send a post request to check CORS
	if (event.httpMethod === 'OPTIONS') return {statusCode: 200}
	
	// Check that the secrets have been retrieved.
	if (!CAPTCHA_KEY || !SNS_ARN) {
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

	// Validates and sanitizes the input values.
	body = validateInput(body);
	if(!body) {
		console.log(VERIFY_INPUT_ERROR);
		return VERIFY_INPUT_ERROR;
	}
	
	// Check if reCAPTCHA validates the request.
	let success = false;
	try {
		success = await verifyRecaptcha(body.token);
	} catch (error) {
		console.log(RECAPTCHA_CONNECTION_ERROR);
		console.log(error);
		return RECAPTCHA_CONNECTION_ERROR;
	}
	if(!success) {
		console.log(RECAPTCHA_VERIFY_ERROR);
		return RECAPTCHA_VERIFY_ERROR;
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
