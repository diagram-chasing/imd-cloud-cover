<figure class="support">
	<p class="kicker">A <a href="https://diagramchasing.fun">Diagram Chasing</a> Production</p>

	<p class="blurb">
		This project is independently produced and reader-supported. Consider sending a tip so we can
		keep making work like this.
	</p>

	<a
		class="cta"
		href="https://diagramchasing.fun/support"
		target="_blank"
		rel="noopener noreferrer"
	>
		₹ Support us
	</a>
</figure>

<style>
	.support {
		max-width: 460px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 32px 28px;
		text-align: center;
		background: var(--paper);
		border: 2px solid var(--ink);
		box-shadow: 4px 4px 0 var(--ink);
	}

	.kicker {
		margin: 0;
		font-family: var(--font-display);
		font-size: 13px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.kicker a {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.blurb {
		margin: 0;
		font-size: 13px;
		line-height: 1.65;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	.cta {
		margin-top: 4px;
		padding: 10px 24px;
		font-family: var(--font-display);
		font-size: 13px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--paper);
		background: var(--ink);
		border: 2px solid var(--ink);
		text-decoration: none;
		transition:
			color 0.12s,
			background 0.12s,
			box-shadow 0.12s,
			transform 0.12s;
	}
	.cta:hover {
		color: var(--ink);
		background: var(--paper);
		box-shadow: 3px 3px 0 var(--ink);
		transform: translate(-1px, -1px);
	}
	.cta:active {
		transform: translate(0, 0);
		box-shadow: none;
	}
</style>
