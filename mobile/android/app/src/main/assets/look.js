// company-android-look-v1: the iPhone's page look (mobile/ios/TDH/DeskTab.swift lookJS), the same on Android.
(function(){var css=[
"html.cs-phone [data-composer-seat]{display:none!important}",
"html.cs-phone .cs-typing{display:block!important;visibility:hidden!important;width:56px;height:28px;margin:6px 0 0 0;padding:0!important;background:none!important;border:0!important;box-shadow:none!important}",
"html.cs-phone,html.cs-phone body,html.cs-phone #root,html.cs-phone #app,html.cs-phone [class*='_frame'],html.cs-phone [data-dsh-center-col],html.cs-phone [data-conversation-scroll],html.cs-phone main{background:transparent!important;background-image:none!important}",
"html.cs-phone .tdh-copy{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;background:none;color:inherit;border-radius:8px;cursor:pointer}",
"html.cs-phone .tdh-copy:active{background:rgba(127,127,127,.18)}",
"html.cs-phone [data-chat-flow-kind=user] .tdh-copy-row{justify-content:flex-end}",
"html.cs-phone .tdh-copy-row{display:flex;align-items:center;gap:10px;margin-top:6px;font-size:12px;color:rgba(28,30,36,.45)}",
"html.cs-phone body[data-ds-dark-theme] .tdh-copy-row{color:rgba(238,241,247,.45)}",
"html.cs-phone [data-conversation-scroll]{padding-bottom:calc(var(--tdh-bottom,0px) + 16px)!important}",
"html.cs-phone [data-chat-flow]{font-family:'Noto Sans SC','HarmonyOS Sans SC',sans-serif!important;font-size:16px;line-height:1.6}",
"html.cs-phone [data-chat-flow-kind=user] [class*='_actions'],html.cs-phone [data-chat-flow-kind=user] [data-clock]{display:none!important}",
"html.cs-phone [data-chat-flow-kind=assistant-step] [data-slot='conversation.chat.node']>div{background:none!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;padding:0 2px!important}",
"html.cs-phone [data-chat-flow-kind=assistant-step]{animation:tdh-in .22s ease-out both}",
"html.cs-phone [data-chat-flow-kind=user]{animation:tdh-up .3s cubic-bezier(.2,.8,.2,1) both}",
"@keyframes tdh-in{from{opacity:0}to{opacity:1}}",
"@keyframes tdh-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}"
].join("\n");var st=document.createElement('style');st.id='tdh-phone-look';st.textContent=css;
(document.head||document.documentElement).appendChild(st);
window.__tdhSetDark=function(d){window.__tdhDark=!!d;var b=document.body;if(!b)return;var has=b.hasAttribute('data-ds-dark-theme');
if(d&&!has)b.setAttribute('data-ds-dark-theme','');if(!d&&has)b.removeAttribute('data-ds-dark-theme');document.documentElement.style.colorScheme=d?'dark':'light';
if(!window.__tdhDarkMo){window.__tdhDarkMo=new MutationObserver(function(){if(document.body.hasAttribute('data-ds-dark-theme')!==window.__tdhDark)window.__tdhSetDark(window.__tdhDark)});
window.__tdhDarkMo.observe(b,{attributes:true,attributeFilter:['data-ds-dark-theme']})}};
if(window.__tdhDark!==undefined)window.__tdhSetDark(window.__tdhDark);
if(!window.__tdhCopyMo){var ICON='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/></svg>';
var OK='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
var clockOf=function(el){var c=el.querySelector('[data-clock]');if(c&&c.innerText.trim())return c.innerText.trim();var p=el.previousElementSibling;while(p){if(p.getAttribute&&p.getAttribute('data-chat-flow-kind')==='user'){var k=p.querySelector('[data-clock]');return k?k.innerText.trim():''}p=p.previousElementSibling}return ''};
var addCopy=function(){var running=!!document.querySelector("[data-conversation-scroll] [data-chat-running='true']");var items=[].slice.call(document.querySelectorAll("[data-chat-flow-kind=user],[data-chat-flow-kind=assistant-step]"));
items.forEach(function(el,i){if(el.querySelector(':scope > .tdh-copy-row'))return;
if(running&&i===items.length-1&&el.getAttribute('data-chat-flow-kind')==='assistant-step')return;
var row=document.createElement('div');row.className='tdh-copy-row';var t=document.createElement('span');t.textContent=clockOf(el);
var b=document.createElement('button');b.className='tdh-copy';b.type='button';b.setAttribute('aria-label','复制');b.innerHTML=ICON;
b.addEventListener('click',function(e){e.stopPropagation();var src=el.querySelector("[class*='_bubble']")||el;var c=src.cloneNode(true);c.querySelectorAll('.tdh-copy-row,[data-clock]').forEach(function(x){x.remove()});
try{webkit.messageHandlers.tdh.postMessage({type:'copy',text:(c.innerText||'').trim()})}catch(err){}b.innerHTML=OK;setTimeout(function(){b.innerHTML=ICON},1400)});
if(el.getAttribute('data-chat-flow-kind')==='user'){row.appendChild(t);row.appendChild(b)}else{row.appendChild(b);row.appendChild(t)}el.appendChild(row)})};
var ct=0;window.__tdhCopyMo=new MutationObserver(function(){clearTimeout(ct);ct=setTimeout(addCopy,300)});
window.__tdhCopyMo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(addCopy,500)}
if(!window.__tdhScrollGuard){window.__tdhScrollGuard=1;var busy=false,bt=0,dTop=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
var settle=function(){clearTimeout(bt);bt=setTimeout(function(){busy=false},260)};
var atEnd=function(sc,v){return v>=sc.scrollHeight-sc.clientHeight-2};
var guard=function(){var sc=document.querySelector('[data-conversation-scroll]');if(!sc||sc.__tdhGuard)return;sc.__tdhGuard=1;
sc.addEventListener('touchstart',function(){busy=true;clearTimeout(bt)},{passive:true,capture:true});
sc.addEventListener('touchend',settle,{passive:true,capture:true});sc.addEventListener('touchcancel',settle,{passive:true,capture:true});
sc.addEventListener('scroll',function(){if(busy&&bt)settle()},{passive:true,capture:true});
Object.defineProperty(sc,'scrollTop',{configurable:true,get:function(){return dTop.get.call(this)},set:function(v){if(busy&&atEnd(this,v))return;dTop.set.call(this,v)}});
['scrollTo','scroll'].forEach(function(n){var f=sc[n].bind(sc);sc[n]=function(a,b){var top=(a&&typeof a==='object')?a.top:b;if(busy&&typeof top==='number'&&atEnd(sc,top))return;return f.apply(null,arguments)}})};
var sIV=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(){if(busy&&this.closest&&this.closest('[data-conversation-scroll]'))return;return sIV.apply(this,arguments)};
new MutationObserver(guard).observe(document.documentElement,{childList:true,subtree:true});guard()}
if(!window.__tdhThinkMo){var lastThink=null;var thinkPost=function(){var b=document.querySelector('.cs-typing');var r=b?b.getBoundingClientRect():null;
var key=b?Math.round(r.left)+','+Math.round(r.top):'off';if(key===lastThink)return;lastThink=key;
try{webkit.messageHandlers.tdh.postMessage(b?{type:'thinking',on:true,x:r.left,y:r.top,w:r.width,h:r.height}:{type:'thinking',on:false})}catch(e){}};
window.__tdhThinkMo=new MutationObserver(thinkPost);window.__tdhThinkMo.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('scroll',thinkPost,true);window.addEventListener('resize',thinkPost)}
var lastN=-1,tm=0;function rep(){var n=document.querySelectorAll("[data-chat-flow-kind=user],[data-chat-flow-kind=assistant-step]").length;
if(n!==lastN){lastN=n;try{webkit.messageHandlers.tdh.postMessage({type:'flow',count:n})}catch(e){}}}
new MutationObserver(function(){clearTimeout(tm);tm=setTimeout(rep,150)}).observe(document.documentElement,{subtree:true,childList:true});setTimeout(rep,400)})();
