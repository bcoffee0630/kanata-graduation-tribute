(() => {
    'use strict';

    const target = new URL('https://admin.eienkanata.com/auth/action/');
    target.search = window.location.search;
    target.hash = window.location.hash;
    window.location.replace(target.href);
})();
