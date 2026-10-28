/**
 * Whether people can choose a language. Off until translation work starts: the owner has
 * deferred Bangla until the rest of the product is done, and a switch that changes almost
 * nothing only confuses. While it is off the switch is hidden (header and account page) and
 * every page is English (`getLocale`), so nobody is left on a part-translated screen with no way
 * back; a choice saved earlier is ignored, not deleted. Set it to true to bring both back as
 * they were.
 */
export const LANGUAGE_CHOICE_ENABLED: boolean = false;
