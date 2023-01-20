/**
 * This script is responsible for handling the form submission of a contact form.
 * It selects the form and its input elements, gets and sanitizes their values,
 * and then validates them using a regular expression and length checks.
*/

/**
 * Regular expression to check if the string is in the format of an email address
 */
const emailRegex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

/**
 * Selects the first form element with the id attribute with value contact from the HTML document.
 */
const form = document.querySelector('form#contact');

/**
 * Selects the input and textarea elements inside the form element using the name attribute.
 */
const mail = form.querySelector('input[name="mail"]');
const subject = form.querySelector('input[name="subject"]');
const mesagge = form.querySelector('textarea[name="mesagge"]');
const submit = form.querySelector('input[name="submit"]');

form.addEventListener('submit', (e) => {
	/**
	 * Prevents traditional form submission.
	 */
	e.preventDefault();

	const token = grecaptcha.getResponse();

	if (token.length === 0) {
		/**
		 * End the event.
		 */
		return;
	} else {
		/**
		 * Gets and sanitizes the value of each of the selected elements.
		 */
		const mailValue = mail.value.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
		const subjectValue = subject.value.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
		const mesaggeValue = mesagge.value.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");

		/**
		 * Validates the input values.
		 */
		if(!emailRegex.test(mailValue) || !subjectValue || subjectValue.length > 100 || !mesaggeValue || mesaggeValue.length > 1000) {
			/**
			 * End the event.
			 */
			return;
		}

		/**
		 * Create an object with the form data.
		 */
		const formData = {
			mail: mailValue,
			subject: subjectValue,
			message: mesaggeValue,
			token: token
		};

		/**
		 * Make the HTTPS request using fetch.
		 */
		fetch('https://API.DOMAIN/API_PATH', {
			method: 'POST',
			body: JSON.stringify(formData),
			headers: {
			'Content-Type': 'application/json'
			}
		})
		.then(response => response.json())
		.then(data => {
			if (data.success) {
				// OK
			} else {
				// KO
			}
		})
		.catch(error => console.error(error));
	}	
});
