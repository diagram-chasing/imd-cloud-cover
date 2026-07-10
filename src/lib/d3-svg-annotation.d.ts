declare module 'd3-svg-annotation' {
	export interface AnnotationSpec {
		x: number;
		y: number;
		nx?: number;
		ny?: number;
		dx?: number;
		dy?: number;
		className?: string;
		color?: string;
		type?: unknown;
		disable?: string[];
		note?: { title?: string; label?: string; wrap?: number; padding?: number; align?: string };
		connector?: {
			type?: string;
			end?: string;
			points?: [number, number][];
			curve?: unknown;
		};
		subject?: Record<string, unknown>;
	}
	export interface AnnotationMaker {
		(selection: unknown): void;
		annotations(a: AnnotationSpec[]): AnnotationMaker;
		type(t: unknown): AnnotationMaker;
		disable(parts: string[]): AnnotationMaker;
		editMode(on: boolean): AnnotationMaker;
		update(): AnnotationMaker;
	}
	export function annotation(): AnnotationMaker;
	export const annotationLabel: unknown;
	export const annotationCallout: unknown;
	export const annotationCalloutElbow: unknown;
	export const annotationCalloutCurve: unknown;
	export const annotationCalloutCircle: unknown;
	export const annotationCalloutRect: unknown;
	export const annotationXYThreshold: unknown;
	export const annotationBadge: unknown;
}
