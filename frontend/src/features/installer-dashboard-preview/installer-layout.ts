/**
 * One horizontal alignment contract for every installer surface.
 *
 * The shell owns the page gutter; the top bar and page content then occupy the
 * same width. Do not add page-level horizontal padding inside the content
 * frame or the search header and body will drift apart again.
 */
export const INSTALLER_SHELL_GUTTER_CLASS = "pe-3 ps-3 desktop:pe-4 desktop:ps-4";
export const INSTALLER_CONTENT_FRAME_CLASS = "w-full";
